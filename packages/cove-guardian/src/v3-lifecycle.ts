/**
 * Cove V3 real-Core lifecycle — DEPLOY + MINT (transaction reality gate).
 * Requires a reachable bitcoind -regtest. Fails (does NOT skip) if unreachable.
 */
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { applyMintV2 } from "@crclaunch/cove-covenant";
import { CHAIN_BITCOIN_REGTEST } from "@crclaunch/cove-wire";
import { buildDeployPsbtV3, buildMintPsbtV3, RESERVE_ANCHOR_SATS } from "./v3/builder.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";

// Deterministic keys: guardian priv=0x42, recovery priv=0x43.
const guardianKey = ECPair.fromPrivateKey(Buffer.alloc(32, 0x42), {
  network: bitcoin.networks.regtest,
});
const guardianXOnly = Buffer.from(guardianKey.publicKey.subarray(1));
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
const NONCE = Buffer.alloc(32, 0xab);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function scriptWitness(items: Buffer[]): Buffer {
  const varInt = (n: number): Buffer => {
    if (n < 0xfd) return Buffer.from([n]);
    if (n <= 0xffff) {
      const b = Buffer.alloc(3);
      b[0] = 0xfd;
      b.writeUInt16LE(n, 1);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(n, 1);
    return b;
  };
  const parts: Buffer[] = [varInt(items.length)];
  for (const it of items) parts.push(varInt(it.length), it);
  return Buffer.concat(parts);
}

class RegtestRpc {
  private id = 0;
  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
  ) {}
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers.authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: { result?: T; error?: { message?: string } | null } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      /* ignore */
    }
    if (!res.ok || json.error)
      throw new Error(`RPC ${method}: ${json.error?.message ?? text.slice(0, 200)}`);
    return json.result as T;
  }
  async createWallet(name: string): Promise<void> {
    try {
      await this.call("createwallet", [name, false, false, "", false, false, false]);
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
    }
  }
  getNewAddress(): Promise<string> {
    return this.call("getnewaddress");
  }
  sendToAddress(addr: string, btc: number): Promise<string> {
    return this.call("sendtoaddress", [addr, btc]);
  }
  generateToAddress(n: number, addr: string): Promise<string[]> {
    return this.call("generatetoaddress", [n, addr]);
  }
  getBlockchainInfo(): Promise<{ chain: string; blocks: number }> {
    return this.call("getblockchaininfo");
  }
}

function findOutputIndex(tx: bitcoin.Transaction, script: Buffer): number {
  return tx.outs.findIndex((o) => o.script.equals(script));
}

function p2wpkhScript(key: ReturnType<typeof ECPair.fromPrivateKey>): Buffer {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest })
    .output!;
}
function p2wpkhAddress(key: ReturnType<typeof ECPair.fromPrivateKey>): string {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest })
    .address!;
}

/** Resolve a freshly-funded P2WPKH output's (txid, vout, script, value). */
async function fundKey(
  rpc: RegtestRpc,
  provider: CoreRpcProvider,
  key: ReturnType<typeof ECPair.fromPrivateKey>,
  btc: number,
  mineAddr: string,
): Promise<{ txid: string; vout: number; script: Buffer; valueSats: bigint }> {
  const addr = p2wpkhAddress(key);
  const txid = await rpc.sendToAddress(addr, btc);
  await rpc.generateToAddress(1, mineAddr);
  const raw = await provider.getRawTransaction(txid);
  const tx = bitcoin.Transaction.fromHex(raw);
  const script = p2wpkhScript(key);
  const vout = findOutputIndex(tx, script);
  assert(vout >= 0, "funding output not found");
  return { txid, vout, script, valueSats: BigInt(tx.outs[vout]!.value) };
}

async function main(): Promise<void> {
  const line = "─".repeat(72);
  const rpc = new RegtestRpc(RPC_URL, RPC_USER, RPC_PASSWORD);
  const info = await rpc.getBlockchainInfo();
  assert(info.chain === "regtest", `expected regtest, got ${info.chain}`);
  const provider = new CoreRpcProvider({ url: RPC_URL, user: RPC_USER, password: RPC_PASSWORD });

  await rpc.createWallet("cove43");
  const mineAddr = await rpc.getNewAddress();
  await rpc.generateToAddress(101, mineAddr);

  const deployer = ECPair.makeRandom({ network: bitcoin.networks.regtest });
  const buyer = ECPair.makeRandom({ network: bitcoin.networks.regtest });
  const feeKey = ECPair.makeRandom({ network: bitcoin.networks.regtest });

  // ── DEPLOY ──
  console.log(line);
  const deployerUtxo = await fundKey(rpc, provider, deployer, 1.0, mineAddr);
  const deploy = buildDeployPsbtV3({
    network: bitcoin.networks.regtest,
    identity: {
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    },
    guardianXOnly,
    recoveryKeyXOnly: recoveryXOnly,
    deployerInputs: [deployerUtxo],
    deployerChangeScript: deployerUtxo.script,
    minerFeeSats: 1_000n,
  });
  deploy.psbt.signInput(0, deployer);
  deploy.psbt.finalizeAllInputs();
  const deployHex = deploy.psbt.extractTransaction().toHex();
  const deployAccept = await provider.testMempoolAccept(deployHex);
  console.log(
    `DEPLOY testmempoolaccept: allowed=${deployAccept.allowed}${deployAccept.rejectReason ? " reject=" + deployAccept.rejectReason : ""}`,
  );
  assert(deployAccept.allowed === true, `deploy rejected: ${deployAccept.rejectReason}`);
  const deployTxid = await provider.broadcastTransaction(deployHex);
  await rpc.generateToAddress(1, mineAddr);
  const deployRaw = await provider.getRawTransaction(deployTxid);
  const deployTx = bitcoin.Transaction.fromHex(deployRaw);
  const vaultVout = findOutputIndex(deployTx, deploy.vault.scriptPubKey);
  assert(vaultVout >= 0, "vault output not found in deploy");
  const vaultValue = BigInt(deployTx.outs[vaultVout]!.value);
  assert(
    vaultValue === RESERVE_ANCHOR_SATS,
    `S0 vault value ${vaultValue} != anchor ${RESERVE_ANCHOR_SATS}`,
  );
  console.log(
    `✓ DEPLOY ${deployTxid} vault=${vaultVout} value=${vaultValue} tokenId=${deploy.tokenId.toString("hex")}`,
  );

  // ── MINT ──
  const buyerUtxo = await fundKey(rpc, provider, buyer, 1.0, mineAddr);
  const mintAmountAtoms = 84_000_000n * 100_000_000n; // 84M tokens (2 stages, fee clears dust)
  const mint = buildMintPsbtV3({
    network: bitcoin.networks.regtest,
    tokenId: deploy.tokenId,
    prevState: deploy.s0,
    prevBacking: {
      txid: deployTxid,
      vout: vaultVout,
      script: deploy.vault.scriptPubKey,
      valueSats: vaultValue,
    },
    mintAmountAtoms,
    guardianXOnly,
    recoveryKeyXOnly: recoveryXOnly,
    buyerInputs: [buyerUtxo],
    buyerCarrierScript: buyerUtxo.script,
    buyerChangeScript: buyerUtxo.script,
    feeScript: p2wpkhScript(feeKey),
    minerFeeSats: 1_000n,
  });

  // Guardian script-path signs the MINT execution leaf.
  mint.psbt.signTaprootInput(0, guardianKey, mint.prevVault.mintLeaf.tapleafHash);
  const sig = mint.psbt.data.inputs[0]!.tapScriptSig![0]!.signature!;
  const reveal = mint.prevVault.mintLeaf.script.subarray(1, 33);
  mint.psbt.updateInput(0, {
    finalScriptWitness: scriptWitness([
      Buffer.from(sig),
      reveal,
      mint.prevVault.mintLeaf.script,
      mint.prevVault.mintControlBlock,
    ]),
  });
  // Buyer signs funding input.
  mint.psbt.signInput(1, buyer);
  // Finalize only the buyer input (input 0's witness was set manually above).
  mint.psbt.finalizeInput(1);
  const mintHex = mint.psbt.extractTransaction().toHex();
  const mintAccept = await provider.testMempoolAccept(mintHex);
  console.log(
    `MINT testmempoolaccept: allowed=${mintAccept.allowed}${mintAccept.rejectReason ? " reject=" + mintAccept.rejectReason : ""}`,
  );
  assert(mintAccept.allowed === true, `mint rejected: ${mintAccept.rejectReason}`);
  const mintTxid = await provider.broadcastTransaction(mintHex);
  await rpc.generateToAddress(1, mineAddr);
  console.log(`✓ MINT ${mintTxid}`);

  // Assert successor state.
  const expected = applyMintV2(deploy.s0, mintAmountAtoms).nextState;
  assert(
    mint.nextState.issuedPublicSupplyAtoms === expected.issuedPublicSupplyAtoms,
    "supply mismatch",
  );
  assert(mint.nextState.backingSats === expected.backingSats, "backing mismatch");
  assert(mint.grossSats === 49_350n, "gross should be 49350 for 84M tokens");

  console.log(
    `    supply=${mint.nextState.issuedPublicSupplyAtoms} backing=${mint.nextState.backingSats} gross=${mint.grossSats} fee=${mint.buyFeeSats}`,
  );
  console.log(line);
  console.log("DEPLOY + MINT lifecycle PASSED (real Bitcoin Core regtest)");
  console.log(`    deployTxid: ${deployTxid}`);
  console.log(`    mintTxid:   ${mintTxid}`);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("v3-lifecycle failed:", e instanceof Error ? e.message : String(e));
    console.error((e as Error).stack?.split("\n").slice(0, 8).join("\n"));
    process.exit(1);
  });
}
