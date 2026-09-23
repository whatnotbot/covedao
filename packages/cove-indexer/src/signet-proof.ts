import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CoreRpcProvider,
  EsploraUtxoProvider,
  LocalP2WPKHSigner,
  bitcoin,
  decodeRawTransaction,
  parseCanonicalOpReturn,
  type BitcoinProtocolTx,
  type ChainUtxo,
} from "@crclaunch/bitcoin";
import {
  COVE_V1_SIGNET_CONFIG,
  buildCoveDeployPsbt,
  buildCoveMintPsbt,
  buildCoveTransferPsbt,
  decodeCoveEnvelope,
  isCoveMagic,
  toCoveTransaction,
  validateCoveOperation,
  type CoveState,
} from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const RPC_URL = process.env.COVE_RPC_URL ?? "https://bitcoin-signet-rpc.publicnode.com";
const ESPLORA = process.env.COVE_ESPLORA_URL ?? "https://blockstream.info/signet/api";
const EXPECTED_SIGNER_ADDRESS = "tb1q3gn3xgduwymejw9vw2xayr4u2ldvc2zf05r3kx";
const B_BACKUP_PATH = fileURLToPath(new URL("../../../.cove-signer-b.wif", import.meta.url));

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function readWif(envKey: string, fileKey: string): string {
  const file = process.env[fileKey];
  if (file) {
    if (!existsSync(file)) throw new Error(`${fileKey} path does not exist: ${file}`);
    return readFileSync(file, "utf8").trim();
  }
  const env = process.env[envKey];
  if (env) return env.trim();
  throw new Error(`Set ${fileKey} (path) or ${envKey} (env) to a signer WIF. It is never printed.`);
}

/** Pure (non-mutating) Cove validation of a decoded + resolved signed tx. */
export function validatePure(state: CoveState, btcTx: BitcoinProtocolTx, txIndex: number): { ok: boolean; reason?: string } {
  const coveOutputs: { index: number; payload: Uint8Array }[] = [];
  for (const out of btcTx.outputs) {
    if (out.scriptPubKeyHex === "6a") continue;
    const payload = parseCanonicalOpReturn(Buffer.from(out.scriptPubKeyHex, "hex"));
    if (payload && isCoveMagic(payload)) coveOutputs.push({ index: out.index, payload });
  }
  if (coveOutputs.length === 0) return { ok: false, reason: "NON_COVE" };
  if (coveOutputs.length > 1) return { ok: false, reason: "MULTIPLE_COVE_OPERATIONS" };
  if (coveOutputs[0]!.index !== 0) return { ok: false, reason: "WRONG_VOUT" };
  const decoded = decodeCoveEnvelope(coveOutputs[0]!.payload);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const mapped = toCoveTransaction(btcTx, decoded.envelope!, txIndex);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  const result = validateCoveOperation(state, mapped.tx, CFG);
  return { ok: result.valid, reason: result.reason ?? undefined };
}

/** Resolve EVERY input's prevout (script + value) from Core. */
async function resolveSignedTxInputs(provider: CoreRpcProvider, signedHex: string): Promise<BitcoinProtocolTx> {
  const tx = decodeRawTransaction(signedHex, "signet");
  for (const input of tx.inputs) {
    if (input.prevTxid === "0".repeat(64)) continue;
    const prev = await provider.getPrevout(input.prevTxid, input.vout);
    if (!prev || prev.valueSats === undefined || prev.scriptPubKeyHex === undefined) {
      throw new Error(`input ${input.prevTxid}:${input.vout} prevout not found`);
    }
    input.prevScriptPubKeyHex = prev.scriptPubKeyHex;
    input.prevValueSats = prev.valueSats;
  }
  return tx;
}

/** Fee-rate cap by multiplication (a floor-divided rate would miss sub-satoshi overflow). */
export function feeRateExceedsCap(feeSats: bigint, vsize: number, maxFeeRateSatVb: bigint): boolean {
  return feeSats > maxFeeRateSatVb * BigInt(vsize);
}

/** Actual fee + vsize from authoritative prevouts and the final tx's vsize. */
export function computeFee(tx: BitcoinProtocolTx, signedHex: string): { feeSats: bigint; vsize: number; feeRate: bigint } {
  const inSats = tx.inputs.reduce((a, i) => {
    if (i.prevValueSats === undefined) throw new Error("missing input prevout value");
    return a + i.prevValueSats;
  }, 0n);
  const outSats = tx.outputs.reduce((a, o) => a + o.valueSats, 0n);
  const feeSats = inSats - outSats;
  if (feeSats < 0n) throw new Error(`negative fee: inputs ${inSats} < outputs ${outSats}`);
  const vsize = bitcoin.Transaction.fromHex(signedHex).virtualSize();
  // Display-only floor; the fee-rate CAP is enforced by multiplication (no floor).
  const feeRate = vsize <= 0 ? 0n : feeSats / BigInt(vsize);
  return { feeSats, vsize, feeRate };
}

async function waitConfirmation(provider: CoreRpcProvider, txid: string): Promise<{ height: number; hash: string; txIndex: number }> {
  for (let i = 0; i < 120; i++) {
    const tip = await provider.getBestHeight();
    for (let h = tip; h >= Math.max(CFG.genesisHeight, tip - 12); h--) {
      const hash = await provider.getBlockHash(h);
      const block = await provider.getBlock(hash);
      const idx = block.txids.indexOf(txid);
      if (idx >= 0) return { height: h, hash, txIndex: idx };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for confirmation of ${txid}`);
}

async function indexConfirmedBlock(provider: CoreRpcProvider, indexer: CoveIndexer, height: number, hash: string): Promise<void> {
  const block = await provider.getBlock(hash);
  const txs: BitcoinProtocolTx[] = [];
  for (let i = 0; i < block.rawTxs.length; i++) {
    const raw = block.rawTxs[i]!;
    let tx: BitcoinProtocolTx;
    try {
      tx = decodeRawTransaction(raw, "signet");
    } catch {
      // Preserve the canonical tx index via a NON_COVE placeholder.
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
        if (!prev || prev.valueSats === undefined || prev.scriptPubKeyHex === undefined) {
          throw new Error(`block ${height}: cannot resolve actor prevout ${input0.prevTxid}:${input0.vout}`);
        }
        input0.prevScriptPubKeyHex = prev.scriptPubKeyHex;
        input0.prevValueSats = prev.valueSats;
      }
    }
    txs.push(tx);
  }
  indexer.processBlock(height, txs);
}

/** Index every block in [from, to] in canonical order (preserving height/txIndex). */
async function catchUpTo(provider: CoreRpcProvider, indexer: CoveIndexer, from: number, to: number): Promise<void> {
  for (let h = from; h <= to; h++) {
    const hash = await provider.getBlockHash(h);
    await indexConfirmedBlock(provider, indexer, h, hash);
  }
}

/** Assert the confirmed tx produced a VALID Cove event with the expected op. */
function assertEvent(indexer: CoveIndexer, txid: string, expectedOp: string): void {
  const ev = indexer.getEvents().find((e) => e.txid === txid);
  assert(ev !== undefined, `no indexed event for ${txid}`);
  assert(ev!.classification === "VALID" && ev!.valid, `event ${txid} not VALID: ${ev!.classification} ${ev!.reason}`);
  assert(ev!.operation === expectedOp, `event ${txid} op ${ev!.operation} != ${expectedOp}`);
}

async function broadcastChecked(provider: CoreRpcProvider, signedHex: string): Promise<string> {
  const pre = await provider.testMempoolAccept(signedHex, CFG.maxFeeRateSatVb);
  if (!pre.allowed) throw new Error(`testmempoolaccept rejected: ${pre.rejectReason ?? "unknown"}`);
  return provider.broadcastTransaction(signedHex);
}

async function verifyUtxos(provider: CoreRpcProvider, utxos: ChainUtxo[]): Promise<ChainUtxo[]> {
  const verified: ChainUtxo[] = [];
  for (const u of utxos) {
    const txout = await provider.getTxout(u.txid, u.vout);
    if (!txout) throw new Error(`UTXO ${u.txid}:${u.vout} is spent or missing.`);
    assert(txout.scriptPubKeyHex === u.scriptPubKeyHex, `UTXO ${u.txid}:${u.vout} scriptPubKey mismatch.`);
    assert(txout.valueSats === u.valueSats, `UTXO ${u.txid}:${u.vout} value mismatch.`);
    verified.push({ ...u, valueSats: txout.valueSats, confirmations: txout.confirmations });
  }
  return verified;
}

function selectCoins(utxos: ChainUtxo[], requiredSats: bigint): { selected: ChainUtxo[]; total: bigint } {
  const sorted = [...utxos].sort((a, b) => (b.valueSats < a.valueSats ? -1 : b.valueSats > a.valueSats ? 1 : 0));
  const selected: ChainUtxo[] = [];
  let total = 0n;
  for (const u of sorted) {
    if (total >= requiredSats) break;
    selected.push(u);
    total += u.valueSats;
  }
  if (total < requiredSats) throw new Error(`Insufficient funds: need ${requiredSats}, have ${total} across ${utxos.length} UTXOs.`);
  return { selected, total };
}

function scriptOf(signer: LocalP2WPKHSigner): string {
  return bitcoin.address.toOutputScript(signer.getAddress(), bitcoin.networks.testnet).toString("hex");
}

async function main() {
  const signerA = new LocalP2WPKHSigner(readWif("COVE_WIF", "COVE_WIF_FILE"), "signet");
  assert(signerA.getAddress() === EXPECTED_SIGNER_ADDRESS, `WIF derives ${signerA.getAddress()}, expected ${EXPECTED_SIGNER_ADDRESS}`);
  console.log("✓ key control verified:", signerA.getAddress());

  // Second signer (recipient): loaded or freshly generated, WIF never printed.
  let signerB: LocalP2WPKHSigner;
  if (process.env.COVE_WIF_B_FILE || process.env.COVE_WIF_B) {
    signerB = new LocalP2WPKHSigner(readWif("COVE_WIF_B", "COVE_WIF_B_FILE"), "signet");
  } else if (existsSync(B_BACKUP_PATH)) {
    signerB = new LocalP2WPKHSigner(readFileSync(B_BACKUP_PATH, "utf8").trim(), "signet");
  } else {
    signerB = LocalP2WPKHSigner.makeRandom("signet");
    writeFileSync(B_BACKUP_PATH, signerB.toWIF() + "\n", { mode: 0o600 });
  }
  console.log("✓ recipient signer B:", signerB.getAddress());

  const provider = new CoreRpcProvider({ url: RPC_URL, maxFeeRateSatVb: CFG.maxFeeRateSatVb });
  const info = await provider.getBlockchainInfo();
  assert(info.chain === "signet", `chain is ${info.chain}, expected signet`);
  const esplora = new EsploraUtxoProvider(ESPLORA, "signet");
  const indexer = new CoveIndexer(CFG); // canonical state (advanced only on confirmation)
  let indexedHeight = CFG.genesisHeight - 1;
  const actorScript = scriptOf(signerA);

  async function freshUtxos(signer: LocalP2WPKHSigner): Promise<ChainUtxo[]> {
    const tip = await provider.getBestHeight();
    const discovered = await esplora.getUtxos(signer.getAddress(), tip);
    const verified = await verifyUtxos(provider, discovered);
    assert(verified.length > 0, `no verified UTXOs for ${signer.getAddress()}`);
    return verified;
  }

  async function preflight(signedHex: string): Promise<{ feeSats: bigint; vsize: number; feeRate: bigint }> {
    const tx = await resolveSignedTxInputs(provider, signedHex);
    const fee = computeFee(tx, signedHex);
    const v = validatePure(indexer.getState(), tx, 0);
    assert(v.ok, `Cove validation failed: ${v.reason}`);
    assert(fee.feeSats <= CFG.maxMinerFeeSats, `fee ${fee.feeSats} exceeds max ${CFG.maxMinerFeeSats}`);
    // Fee-rate cap by multiplication (no flooring of the rate before comparison).
    assert(!feeRateExceedsCap(fee.feeSats, fee.vsize, CFG.maxFeeRateSatVb), `fee rate exceeds max ${CFG.maxFeeRateSatVb} sat/vB (fee ${fee.feeSats}, vsize ${fee.vsize})`);
    return fee;
  }

  async function catchUpToTip(): Promise<void> {
    const tip = await provider.getBestHeight();
    if (tip > indexedHeight) {
      await catchUpTo(provider, indexer, indexedHeight + 1, tip);
      indexedHeight = tip;
    }
  }

  async function confirmAndIndex(txid: string, op: string, assertState: () => void): Promise<{ height: number; txIndex: number }> {
    const conf = await waitConfirmation(provider, txid);
    // Index EVERY intervening block through the confirmation block (preserving
    // exact height and txIndex), not just the confirmation block.
    if (conf.height > indexedHeight) {
      await catchUpTo(provider, indexer, indexedHeight + 1, conf.height);
      indexedHeight = conf.height;
    }
    assertEvent(indexer, txid, op);
    assertState();
    return conf;
  }

  // Initialize: canonical replay from activation height to the current tip.
  const initialTip = await provider.getBestHeight();
  if (initialTip >= CFG.genesisHeight) {
    await catchUpTo(provider, indexer, CFG.genesisHeight, initialTip);
    indexedHeight = initialTip;
    console.log(`✓ replayed genesis ${CFG.genesisHeight} → ${initialTip}`);
  }

  // ── DEPLOY ────────────────────────────────────────────────────────────────
  {
    await catchUpToTip();
    const utxos = await freshUtxos(signerA);
    const coins = selectCoins(utxos, 10_000n + 1_000n);
    const psbt = buildCoveDeployPsbt({
      network: "signet", ticker: "FROG", inputs: coins.selected,
      changeAddress: signerA.getAddress(), feeRateSatVb: 2n, config: CFG,
    });
    const hex = await signerA.signPsbt(psbt.psbtBase64);
    const fee = await preflight(hex);
    const txid = await broadcastChecked(provider, hex);
    const conf = await confirmAndIndex(txid, "DEPLOY", () => {
      const token = indexer.getState().tokens.get(txid);
      assert(token !== undefined, "FROG token not created");
      assert(token!.ticker === "FROG", `ticker ${token!.ticker} != FROG`);
      assert(token!.confirmedSupplyAtoms === 0n, "initial supply not 0");
    });
    console.log(`✓ DEPLOY ${txid} @ ${conf.height} tx=${conf.txIndex} fee=${fee.feeSats} rate=${fee.feeRate}`);
  }

  // ── MINT (recipient = signerA, who becomes the token holder) ──────────────
  const mintAmount = 2_000_000n * 100_000_000n;
  {
    await catchUpToTip();
    const utxos = await freshUtxos(signerA);
    const coins = selectCoins(utxos, 1_010n + 1_000n);
    const psbt = buildCoveMintPsbt({
      network: "signet", ticker: "FROG", amountAtoms: mintAmount, supplyBeforeAtoms: 0n,
      recipientScriptHex: actorScript, inputs: coins.selected,
      changeAddress: signerA.getAddress(), feeRateSatVb: 2n, config: CFG,
    });
    const hex = await signerA.signPsbt(psbt.psbtBase64);
    const fee = await preflight(hex);
    const txid = await broadcastChecked(provider, hex);
    const conf = await confirmAndIndex(txid, "MINT", () => {
      const dep = indexer.getState().tickerIndex.get("FROG")!;
      const t = indexer.getState().tokens.get(dep)!;
      assert(t.confirmedSupplyAtoms === mintAmount, `mint supply ${t.confirmedSupplyAtoms} != ${mintAmount}`);
      const bal = indexer.getState().balances.get(actorScript)?.get(dep);
      assert(bal?.availableAtoms === mintAmount, "mint balance wrong");
    });
    console.log(`✓ MINT ${txid} @ ${conf.height} tx=${conf.txIndex} fee=${fee.feeSats}`);
  }

  // ── TRANSFER (signerA → signerB) ──────────────────────────────────────────
  const transferAmount = 500_000n * 100_000_000n;
  {
    await catchUpToTip();
    const utxos = await freshUtxos(signerA);
    const coins = selectCoins(utxos, 1_000n);
    const psbt = buildCoveTransferPsbt({
      network: "signet", ticker: "FROG", amountAtoms: transferAmount,
      recipientScriptHex: scriptOf(signerB), actorScriptHex: actorScript,
      inputs: coins.selected, changeAddress: signerA.getAddress(), feeRateSatVb: 2n, config: CFG,
    });
    const hex = await signerA.signPsbt(psbt.psbtBase64);
    const fee = await preflight(hex);
    const txid = await broadcastChecked(provider, hex);
    const conf = await confirmAndIndex(txid, "TRANSFER", () => {
      const dep = indexer.getState().tickerIndex.get("FROG")!;
      const a = indexer.getState().balances.get(actorScript)?.get(dep);
      const b = indexer.getState().balances.get(scriptOf(signerB))?.get(dep);
      assert(a?.availableAtoms === mintAmount - transferAmount, "A balance wrong after transfer");
      assert(b?.availableAtoms === transferAmount, "B balance wrong after transfer");
    });
    console.log(`✓ TRANSFER ${txid} @ ${conf.height} tx=${conf.txIndex} fee=${fee.feeSats}`);
  }

  console.log(`✓ state root: ${indexer.getStateRoot()}`);
  console.log("Real Cove signet lifecycle complete.");
  process.exit(0);
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("cove:signet-proof failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
