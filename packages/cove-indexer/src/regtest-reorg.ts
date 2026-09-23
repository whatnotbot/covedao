import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import {
  CoreRpcProvider,
  LocalP2WPKHSigner,
  bitcoin,
  decodeRawTransaction,
  parseCanonicalOpReturn,
  type BitcoinBlock,
  type BitcoinProtocolTx,
  type ChainUtxo,
} from "@crclaunch/bitcoin";
import {
  COVE_V1_REGTEST_CONFIG,
  buildCoveDeployPsbt,
  buildCoveMintPsbt,
  buildCoveTransferPsbt,
  isCoveMagic,
} from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";
import { CoveStore } from "./store.js";

/**
 * REAL Bitcoin Core regtest reorg lifecycle (CI-only). Uses a locally running
 * `bitcoind -regtest` (no Docker). Exercises:
 *   DEPLOY → mine → MINT → mine → TRANSFER → mine
 *   restart worker (reconstruct + verify checkpoint)
 *   invalidateblock → mine competing branch
 *   worker recovery (detect reorg, clear, rebuild)
 *   clean replay
 * and REQUIRES recovered root == clean replay root.
 *
 * NOTE: the signer WIF here is a throwaway REGTEST key created for this
 * ephemeral chain. It is never a mainnet key and never leaves the CI sandbox.
 */

const CFG = COVE_V1_REGTEST_CONFIG;
const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";
const MINT_AMOUNT_ATOMS = 2_000_000n * 100_000_000n;
const TRANSFER_AMOUNT_ATOMS = 500_000n * 100_000_000n;
const RECIPIENT_SCRIPT = "0014" + "ab".repeat(20); // valid P2WPKH (throwaway)

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/** Minimal JSON-RPC client for the wallet/mining control RPCs bitcoind exposes. */
class RegtestRpc {
  private id = 0;
  constructor(private readonly url: string, private readonly user: string, private readonly password: string) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers.authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message?: string } | null };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message ?? "error"}`);
    return json.result as T;
  }

  async createWallet(name: string): Promise<void> {
    try {
      await this.call("createwallet", [name]);
    } catch {
      await this.call("loadwallet", [name]);
    }
  }

  async importPrivKey(wif: string, label: string): Promise<void> {
    await this.call("importprivkey", [wif, label, false]);
  }

  async generateToAddress(n: number, address: string): Promise<string[]> {
    return this.call<string[]>("generatetoaddress", [n, address]);
  }

  async listUnspent(minconf: number, maxconf: number, addresses: string[]): Promise<{ txid: string; vout: number; amount: number; confirmations: number; scriptPubKey: string }[]> {
    return this.call("listunspent", [minconf, maxconf, addresses]);
  }

  async invalidateBlock(hash: string): Promise<void> {
    await this.call("invalidateblock", [hash]);
  }

  async getBlockchainInfo(): Promise<{ chain: string; blocks: number }> {
    return this.call("getblockchaininfo");
  }
}

function btcToSats(btc: number): bigint {
  return BigInt(Math.round(btc * 1e8));
}

async function waitForRpc(rpc: RegtestRpc): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      await rpc.getBlockchainInfo();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error("bitcoind RPC never became ready");
}

/** Decode a block's txs, resolving Cove actor prevouts from the full node. */
async function decodeBlock(provider: CoreRpcProvider, block: BitcoinBlock): Promise<BitcoinProtocolTx[]> {
  const txs: BitcoinProtocolTx[] = [];
  for (let i = 0; i < block.rawTxs.length; i++) {
    const raw = block.rawTxs[i]!;
    let tx: BitcoinProtocolTx;
    try {
      tx = decodeRawTransaction(raw, "regtest");
    } catch {
      tx = { txid: block.txids[i]!, version: 0, locktime: 0, inputs: [], outputs: [] };
    }
    const isCove = tx.outputs.some((o) => {
      if (o.scriptPubKeyHex === "6a") return false;
      const p = parseCanonicalOpReturn(Buffer.from(o.scriptPubKeyHex, "hex"));
      return !!p && isCoveMagic(p);
    });
    if (isCove) {
      const input0 = tx.inputs[0]!;
      if (input0.prevTxid !== "0".repeat(64)) {
        const prev = await provider.getPrevout(input0.prevTxid, input0.vout);
        if (!prev) throw new Error(`cannot resolve actor prevout ${input0.prevTxid}:${input0.vout}`);
        input0.prevScriptPubKeyHex = prev.scriptPubKeyHex;
        input0.prevValueSats = prev.valueSats;
      }
    }
    txs.push(tx);
  }
  return txs;
}

async function indexRange(provider: CoreRpcProvider, indexer: CoveIndexer, from: number, to: number): Promise<void> {
  for (let h = from; h <= to; h++) {
    const hash = await provider.getBlockHash(h);
    const block = await provider.getBlock(hash);
    indexer.processBlock(h, await decodeBlock(provider, block));
  }
}

async function indexAndPersist(provider: CoreRpcProvider, store: CoveStore, indexer: CoveIndexer, from: number, to: number): Promise<void> {
  for (let h = from; h <= to; h++) {
    const hash = await provider.getBlockHash(h);
    const block = await provider.getBlock(hash);
    indexer.processBlock(h, await decodeBlock(provider, block));
    await store.persistBlock(CFG.network, h, hash, block.previousBlockHash, indexer.getState(), indexer.getEvents(), indexer.getStateRoot());
  }
}

function selectCoins(utxos: ChainUtxo[], required: bigint): { selected: ChainUtxo[]; total: bigint } {
  const sorted = [...utxos].sort((a, b) => (b.valueSats < a.valueSats ? -1 : b.valueSats > a.valueSats ? 1 : 0));
  const selected: ChainUtxo[] = [];
  let total = 0n;
  for (const u of sorted) {
    if (total >= required) break;
    selected.push(u);
    total += u.valueSats;
  }
  if (total < required) throw new Error(`insufficient funds: need ${required}, have ${total}`);
  return { selected, total };
}

async function freshUtxos(rpc: RegtestRpc, address: string, requireConfirmed: boolean): Promise<ChainUtxo[]> {
  const raw = await rpc.listUnspent(requireConfirmed ? 1 : 0, 9999999, [address]);
  const utxos: ChainUtxo[] = raw.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    scriptPubKeyHex: u.scriptPubKey,
    valueSats: btcToSats(u.amount),
    confirmations: u.confirmations,
  }));
  if (utxos.length === 0) throw new Error(`no ${requireConfirmed ? "confirmed" : ""} UTXOs for ${address}`);
  return utxos;
}

async function main(): Promise<void> {
  const rpc = new RegtestRpc(RPC_URL, RPC_USER, RPC_PASSWORD);
  await waitForRpc(rpc);
  const info = await rpc.getBlockchainInfo();
  assert(info.chain === "regtest", `chain is ${info.chain}, expected regtest`);

  const provider = new CoreRpcProvider({ url: RPC_URL, user: RPC_USER, password: RPC_PASSWORD, maxFeeRateSatVb: CFG.maxFeeRateSatVb });

  const signerA = LocalP2WPKHSigner.makeRandom("regtest");
  const actorAddress = signerA.getAddress();
  const actorScript = bitcoin.address.toOutputScript(actorAddress, bitcoin.networks.regtest).toString("hex");

  await rpc.createWallet("cove");
  await rpc.importPrivKey(signerA.toWIF(), "canary-actor");
  await rpc.generateToAddress(101, actorAddress);
  console.log("✓ funded actor (101 regtest blocks)");

  const broadcastAndMine = async (hex: string): Promise<string> => {
    const txid = await provider.broadcastTransaction(hex);
    await rpc.generateToAddress(1, actorAddress);
    return txid;
  };

  // DEPLOY
  let coins = selectCoins(await freshUtxos(rpc, actorAddress, true), CFG.launchFeeSats + 1_000n);
  let psbt = buildCoveDeployPsbt({ network: "regtest", ticker: "FROG", inputs: coins.selected, changeAddress: actorAddress, feeRateSatVb: 2n, config: CFG });
  const deployTxid = await broadcastAndMine(await signerA.signPsbt(psbt.psbtBase64));
  console.log(`✓ DEPLOY ${deployTxid}`);

  // MINT (to self)
  coins = selectCoins(await freshUtxos(rpc, actorAddress, true), 1_010n + 1_000n);
  psbt = buildCoveMintPsbt({ network: "regtest", ticker: "FROG", amountAtoms: MINT_AMOUNT_ATOMS, supplyBeforeAtoms: 0n, recipientScriptHex: actorScript, inputs: coins.selected, changeAddress: actorAddress, feeRateSatVb: 2n, config: CFG });
  const mintTxid = await broadcastAndMine(await signerA.signPsbt(psbt.psbtBase64));
  console.log(`✓ MINT ${mintTxid}`);

  // TRANSFER (to RECIPIENT_SCRIPT)
  coins = selectCoins(await freshUtxos(rpc, actorAddress, true), 1_000n);
  psbt = buildCoveTransferPsbt({ network: "regtest", ticker: "FROG", amountAtoms: TRANSFER_AMOUNT_ATOMS, recipientScriptHex: RECIPIENT_SCRIPT, actorScriptHex: actorScript, inputs: coins.selected, changeAddress: actorAddress, feeRateSatVb: 2n, config: CFG });
  const transferTxid = await broadcastAndMine(await signerA.signPsbt(psbt.psbtBase64));
  console.log(`✓ TRANSFER ${transferTxid}`);

  const tip = await provider.getBestHeight();
  console.log(`✓ lifecycle mined; tip=${tip}`);

  // ── Worker: persist + restart ──
  const dbUrl = process.env.DATABASE_URL;
  assert(!!dbUrl, "DATABASE_URL is required for worker persistence.");
  const store = new CoveStore(dbUrl!);
  await store.clearCove(CFG.network);

  const liveIndexer = new CoveIndexer(CFG);
  await indexAndPersist(provider, store, liveIndexer, CFG.genesisHeight, tip);
  const liveRoot = liveIndexer.getStateRoot();

  const cursor = await store.getCursor(CFG.network);
  if (!cursor) throw new Error("cursor not persisted");
  const checkpoint = await store.getLatestCheckpoint(CFG.network);
  if (!checkpoint || checkpoint.height !== cursor.height) throw new Error("checkpoint/cursor mismatch");
  if (checkpoint.stateRoot !== liveRoot) throw new Error("checkpoint root != live root");

  const restarted = new CoveIndexer(CFG);
  await indexRange(provider, restarted, CFG.genesisHeight, Number(cursor.height));
  assert(restarted.getStateRoot() === liveRoot, `restart root ${restarted.getStateRoot()} != live root ${liveRoot}`);
  console.log(`✓ restart reconstruction == live root ${liveRoot}`);

  // ── Reorg: invalidate TRANSFER block, mine competing branch ──
  const transferBlockHash = await provider.getBlockHash(tip);
  await rpc.invalidateBlock(transferBlockHash);
  await rpc.generateToAddress(2, actorAddress);
  const newTip = await provider.getBestHeight();
  console.log(`✓ reorg: invalidated ${transferBlockHash.slice(0, 8)}; new tip=${newTip}`);

  // ── Worker recovery: cursor hash mismatch → clear + rebuild ──
  const stored = await store.getCursor(CFG.network);
  if (!stored) throw new Error("cursor missing before recovery");
  const chainHashAtStoredHeight = await provider.getBlockHash(Number(stored.height));
  assert(chainHashAtStoredHeight !== stored.blockHash, "expected cursor hash mismatch after reorg (sanity)");
  await store.clearCove(CFG.network);

  const recovered = new CoveIndexer(CFG);
  await indexAndPersist(provider, store, recovered, CFG.genesisHeight, newTip);
  const recoveredRoot = recovered.getStateRoot();

  const clean = new CoveIndexer(CFG);
  await indexRange(provider, clean, CFG.genesisHeight, newTip);
  const cleanRoot = clean.getStateRoot();

  console.log(`  recovered root ${recoveredRoot}`);
  console.log(`  clean replay   ${cleanRoot}`);
  assert(recoveredRoot === cleanRoot, `recovered ${recoveredRoot} != clean replay ${cleanRoot}`);

  const events = recovered.getEvents().filter((e) => e.classification === "VALID");
  assert(events.some((e) => e.operation === "DEPLOY" && e.txid === deployTxid), "DEPLOY not in recovered state");
  assert(events.some((e) => e.operation === "MINT" && e.txid === mintTxid), "MINT not in recovered state");
  assert(events.some((e) => e.operation === "TRANSFER" && e.txid === transferTxid), "TRANSFER not in recovered state");

  console.log("REGTEST REORG LIFECYCLE PASSED: recovered root == clean replay root");
  process.exit(0);
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("regtest-reorg failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
