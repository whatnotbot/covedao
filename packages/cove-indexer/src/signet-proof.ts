import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { readFileSync } from "node:fs";
import {
  CoreRpcProvider,
  EsploraUtxoProvider,
  LocalP2WPKHSigner,
  decodeRawTransaction,
  type ChainUtxo,
} from "@crclaunch/bitcoin";
import {
  COVE_V1_SIGNET_CONFIG,
  buildCoveDeployPsbt,
  buildCoveMintPsbt,
  buildCoveTransferPsbt,
} from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const RPC_URL = process.env.COVE_RPC_URL ?? "https://bitcoin-signet-rpc.publicnode.com";
const ESPLORA = process.env.COVE_ESPLORA_URL ?? "https://blockstream.info/signet/api";
const EXPECTED_SIGNER_ADDRESS = "tb1q3gn3xgduwymejw9vw2xayr4u2ldvc2zf05r3kx";

function readWif(): string {
  const file = process.env.COVE_WIF_FILE;
  if (file) return readFileSync(file, "utf8").trim();
  const env = process.env.COVE_WIF;
  if (env) return env.trim();
  throw new Error("Set COVE_WIF_FILE (path) or COVE_WIF (env) to the owner signer WIF. It is never printed.");
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Cross-check Esplora-discovered UTXOs against Bitcoin Core (authoritative). */
async function verifyUtxos(provider: CoreRpcProvider, utxos: ChainUtxo[]): Promise<ChainUtxo[]> {
  const verified: ChainUtxo[] = [];
  for (const u of utxos) {
    const txout = await provider.getTxout(u.txid, u.vout);
    if (!txout) throw new Error(`UTXO ${u.txid}:${u.vout} is spent or missing on the node.`);
    assert(txout.scriptPubKeyHex === u.scriptPubKeyHex, `UTXO ${u.txid}:${u.vout} scriptPubKey mismatch.`);
    assert(txout.valueSats === u.valueSats, `UTXO ${u.txid}:${u.vout} value mismatch (${txout.valueSats} != ${u.valueSats}).`);
    verified.push({ ...u, valueSats: txout.valueSats, confirmations: txout.confirmations });
  }
  return verified;
}

/** Deterministic coin selection: largest-first accumulative. Throws on shortfall. */
function selectCoins(utxos: ChainUtxo[], requiredSats: bigint): { selected: ChainUtxo[]; total: bigint } {
  const sorted = [...utxos].sort((a, b) => (b.valueSats < a.valueSats ? -1 : b.valueSats > a.valueSats ? 1 : 0));
  const selected: ChainUtxo[] = [];
  let total = 0n;
  for (const u of sorted) {
    if (total >= requiredSats) break;
    selected.push(u);
    total += u.valueSats;
  }
  if (total < requiredSats) {
    throw new Error(`Insufficient funds: need ${requiredSats} sats, have ${total} sats across ${utxos.length} UTXOs.`);
  }
  return { selected, total };
}

/** Decode the signed tx, resolve input-0 prevout, and run the Cove validator. */
function validateSignedCoveTx(
  indexer: CoveIndexer,
  signedHex: string,
  prevScript: string,
  height: number,
  txIndex: number,
): { ok: boolean; reason?: string; txid: string; feeSats: bigint; feeRate: bigint } {
  const tx = decodeRawTransaction(signedHex, "signet");
  tx.inputs[0]!.prevScriptPubKeyHex = prevScript;

  const inSats = tx.inputs.reduce((a, i) => a + (i.prevValueSats ?? 0n), 0n);
  const outSats = tx.outputs.reduce((a, o) => a + o.valueSats, 0n);
  const feeSats = inSats - outSats;
  const vsize = tx.inputs.length * 68 + tx.outputs.length * 31 + 11;
  const feeRate = vsize === 0 ? 0n : feeSats / BigInt(vsize);

  const r = indexer.processTx(height, txIndex, tx);
  return { ok: r.classification === "VALID", reason: r.reason ?? undefined, txid: tx.txid, feeSats, feeRate };
}

async function waitConfirmation(provider: CoreRpcProvider, txid: string): Promise<{ height: number; hash: string }> {
  for (let i = 0; i < 120; i++) {
    const tip = await provider.getBestHeight();
    // Scan back a few blocks for the txid.
    for (let h = tip; h >= Math.max(CFG.genesisHeight, tip - 12); h--) {
      const hash = await provider.getBlockHash(h);
      const block = await provider.getBlock(hash);
      if (block.txids.includes(txid)) return { height: h, hash };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for confirmation of ${txid}`);
}

async function broadcastChecked(provider: CoreRpcProvider, signedHex: string): Promise<string> {
  const pre = await provider.testMempoolAccept(signedHex, CFG.maxFeeRateSatVb);
  if (!pre.allowed) throw new Error(`testmempoolaccept rejected: ${pre.rejectReason ?? "unknown"}`);
  return provider.broadcastTransaction(signedHex);
}

async function main() {
  const wif = readWif();
  const signer = new LocalP2WPKHSigner(wif, "signet");
  assert(signer.getAddress() === EXPECTED_SIGNER_ADDRESS, `WIF derives ${signer.getAddress()}, expected ${EXPECTED_SIGNER_ADDRESS}`);
  console.log("✓ key control verified:", signer.getAddress());

  const provider = new CoreRpcProvider({ url: RPC_URL, maxFeeRateSatVb: CFG.maxFeeRateSatVb });
  const info = await provider.getBlockchainInfo();
  assert(info.chain === "signet", `chain is ${info.chain}, expected signet`);
  const tip = await provider.getBestHeight();

  const esplora = new EsploraUtxoProvider(ESPLORA, "signet");
  const utxos = await verifyUtxos(provider, await esplora.getUtxos(signer.getAddress(), tip));
  console.log(`✓ ${utxos.length} verified UTXOs, total ${utxos.reduce((a, u) => a + u.valueSats, 0n)} sats`);

  const actorScript = "00148a271321bc71379938ac728dd20ebc57dacc2849"; // signer scriptPubKey
  const indexer = new CoveIndexer(CFG);

  // ── DEPLOY ────────────────────────────────────────────────────────────────
  const deployFee = 10_000n + 1_000n;
  const deployCoins = selectCoins(utxos, deployFee);
  const deployPsbt = buildCoveDeployPsbt({
    network: "signet", ticker: "FROG", inputs: deployCoins.selected,
    changeAddress: signer.getAddress(), feeRateSatVb: 2n, config: CFG,
  });
  const deployHex = await signer.signPsbt(deployPsbt.psbtBase64);
  const deployCheck = validateSignedCoveTx(indexer, deployHex, actorScript, tip + 1, 0);
  assert(deployCheck.ok, `DEPLOY invalid: ${deployCheck.reason}`);
  assert(deployCheck.feeSats <= CFG.maxMinerFeeSats, "DEPLOY fee exceeds max");
  assert(deployCheck.feeRate <= CFG.maxFeeRateSatVb, "DEPLOY fee rate exceeds max");
  const deployTxid = await broadcastChecked(provider, deployHex);
  const deployConf = await waitConfirmation(provider, deployTxid);
  console.log(`✓ DEPLOY ${deployTxid} @ ${deployConf.height} (fee ${deployCheck.feeSats}, rate ${deployCheck.feeRate})`);

  // ── MINT ──────────────────────────────────────────────────────────────────
  const mintAmount = 2_000_000n * 100_000_000n; // 2M tokens → 1000 sats curve
  const mintPsbt = buildCoveMintPsbt({
    network: "signet", ticker: "FROG", amountAtoms: mintAmount, supplyBeforeAtoms: 0n,
    recipientScriptHex: actorScript, inputs: deployCoins.selected,
    changeAddress: signer.getAddress(), feeRateSatVb: 2n, config: CFG,
  });
  const mintHex = await signer.signPsbt(mintPsbt.psbtBase64);
  const mintCheck = validateSignedCoveTx(indexer, mintHex, actorScript, deployConf.height + 1, 0);
  assert(mintCheck.ok, `MINT invalid: ${mintCheck.reason}`);
  const mintTxid = await broadcastChecked(provider, mintHex);
  const mintConf = await waitConfirmation(provider, mintTxid);
  console.log(`✓ MINT ${mintTxid} @ ${mintConf.height} (fee ${mintCheck.feeSats})`);

  // ── TRANSFER ──────────────────────────────────────────────────────────────
  const transferAmount = 500_000n * 100_000_000n; // 500k tokens
  const recipientB = "0014" + "bb".repeat(20); // second signer's scriptPubKey
  const transferPsbt = buildCoveTransferPsbt({
    network: "signet", ticker: "FROG", amountAtoms: transferAmount,
    recipientScriptHex: recipientB, actorScriptHex: actorScript,
    inputs: deployCoins.selected, changeAddress: signer.getAddress(), feeRateSatVb: 2n, config: CFG,
  });
  const transferHex = await signer.signPsbt(transferPsbt.psbtBase64);
  const transferCheck = validateSignedCoveTx(indexer, transferHex, actorScript, mintConf.height + 1, 0);
  assert(transferCheck.ok, `TRANSFER invalid: ${transferCheck.reason}`);
  const transferTxid = await broadcastChecked(provider, transferHex);
  const transferConf = await waitConfirmation(provider, transferTxid);
  console.log(`✓ TRANSFER ${transferTxid} @ ${transferConf.height} (fee ${transferCheck.feeSats})`);

  console.log(`✓ state root: ${indexer.getStateRoot()}`);
  console.log("Real Cove signet lifecycle complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error("cove:signet-proof failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
