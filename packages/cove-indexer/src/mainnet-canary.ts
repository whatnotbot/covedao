import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CoreRpcProvider,
  EsploraChainProvider,
  EsploraUtxoProvider,
  bitcoin,
  decodeRawTransaction,
  parseCanonicalOpReturn,
  type BitcoinProtocolTx,
  type ChainUtxo,
} from "@crclaunch/bitcoin";
import {
  buildCoveDeployPsbt,
  buildCoveMintPsbt,
  buildCoveTransferPsbt,
  decodeCoveEnvelope,
  isCoveMagic,
  makeCoveMainnetConfig,
  toCoveTransaction,
  validateCoveOperation,
  type CoveConfig,
  type CoveState,
} from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";
import { computeFee, feeRateExceedsCap } from "./signet-proof.js";
import { decodeMainnetCustodyAddress } from "./mainnet-custody.js";

/**
 * Cove V1 MAINNET CANARY — a resumable, EXTERNAL-SIGNING lifecycle rehearsal of
 * DEPLOY → MINT → TRANSFER against real mainnet.
 *
 * This tool NEVER holds a mainnet private key. For each step it exports an
 * unsigned PSBT, the owner signs it OUTSIDE this process, and the signed
 * transaction is imported back for validation + (under `--confirm-mainnet`)
 * broadcast. A WIF-free manifest makes the whole lifecycle resumable by local
 * txid, so a lost RPC response can never cause a double spend.
 *
 * Activation (item 3): the mainnet activation height H MUST be chosen as a
 * FUTURE Bitcoin block height and committed (COVE_V1_MAINNET_GENESIS_HEIGHT)
 * BEFORE the first mainnet Cove transaction. This tool refuses to run until H
 * is set and the chain tip has reached H.
 */

const ESPLORA = process.env.COVE_MAINNET_ESPLORA_URL || "https://blockstream.info/api";
const RPC_URL = process.env.COVE_MAINNET_RPC_URL || "";
const MANIFEST_PATH = fileURLToPath(new URL("../../../.cove-mainnet-canary.json", import.meta.url));
const MINT_AMOUNT_ATOMS = 2_000_000n * 100_000_000n;
const TRANSFER_AMOUNT_ATOMS = 500_000n * 100_000_000n;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function requireEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`${key}: REQUIRED (missing)`);
  return v;
}

function optionalEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

interface CanaryStep {
  unsignedPsbtBase64?: string;
  unsignedHex?: string;
  expectedTxid?: string;
  feeSats?: string;
  vsize?: number;
  txid?: string;
  height?: number;
  blockHash?: string;
  stateRoot?: string;
}

interface CanaryManifest {
  protocol: "cove-mainnet-canary";
  network: "mainnet";
  ticker: string;
  activationHeight: number;
  treasuryAddress: string;
  settlementAddress: string;
  actorAddress: string;
  recipientAddress: string;
  deploy?: CanaryStep;
  mint?: CanaryStep;
  transfer?: CanaryStep;
  finalStateRoot?: string;
  replayStateRoot?: string;
  rootsEqual?: boolean;
}

type CanaryAction = "DEPLOY" | "MINT" | "TRANSFER" | "DONE";

function loadManifest(): CanaryManifest | undefined {
  if (!existsSync(MANIFEST_PATH)) return undefined;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as CanaryManifest;
}

function saveManifest(m: CanaryManifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
}

function localTxid(hex: string): string {
  return bitcoin.Transaction.fromHex(hex).getId();
}

function stepOf(manifest: CanaryManifest, action: Exclude<CanaryAction, "DONE">): CanaryStep {
  if (action === "DEPLOY") return (manifest.deploy ??= {});
  if (action === "MINT") return (manifest.mint ??= {});
  return (manifest.transfer ??= {});
}

/** Pure decision-driven resume, mirroring the signet/mutinynet proofs. */
function decideNextCanaryAction(state: CoveState, manifest: CanaryManifest): CanaryAction {
  const dep = state.tickerIndex.get(manifest.ticker);
  if (dep === undefined) {
    return manifest.deploy?.txid ? "DEPLOY" : "DEPLOY"; // DEPLOY still pending confirm/resolve
  }
  const token = state.tokens.get(dep)!;
  if (token.confirmedSupplyAtoms < MINT_AMOUNT_ATOMS) {
    return "MINT";
  }
  const actorScript = bitcoin.address.toOutputScript(manifest.actorAddress, bitcoin.networks.bitcoin).toString("hex");
  const recipientScript = bitcoin.address.toOutputScript(manifest.recipientAddress, bitcoin.networks.bitcoin).toString("hex");
  const aBal = state.balances.get(actorScript)?.get(dep)?.availableAtoms ?? 0n;
  const bBal = state.balances.get(recipientScript)?.get(dep)?.availableAtoms ?? 0n;
  if (aBal === MINT_AMOUNT_ATOMS - TRANSFER_AMOUNT_ATOMS && bBal === TRANSFER_AMOUNT_ATOMS) {
    return "DONE";
  }
  return "TRANSFER";
}

function readSignedTx(): string | undefined {
  const path = optionalEnv("COVE_MAINNET_SIGNED_TX_FILE");
  if (path) {
    if (!existsSync(path)) throw new Error(`COVE_MAINNET_SIGNED_TX_FILE does not exist: ${path}`);
    return readFileSync(path, "utf8").trim();
  }
  return optionalEnv("COVE_MAINNET_SIGNED_TX");
}

function readSignedHex(): string | undefined {
  const raw = readSignedTx();
  if (raw) return raw;
  const psbtB64 = optionalEnv("COVE_MAINNET_SIGNED_PSBT");
  if (!psbtB64) return undefined;
  const psbt = bitcoin.Psbt.fromBase64(psbtB64, { network: bitcoin.networks.bitcoin });
  try {
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  } catch (e) {
    throw new Error(`signed PSBT is not final (all inputs must be finalized): ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyUtxos(provider: EsploraChainProvider, utxos: ChainUtxo[]): Promise<ChainUtxo[]> {
  const verified: ChainUtxo[] = [];
  for (const u of utxos) {
    const prev = await provider.getPrevout(u.txid, u.vout);
    if (!prev) throw new Error(`UTXO ${u.txid}:${u.vout} missing on chain`);
    assert(prev.scriptPubKeyHex === u.scriptPubKeyHex, `UTXO ${u.txid}:${u.vout} script mismatch`);
    assert(prev.valueSats === u.valueSats, `UTXO ${u.txid}:${u.vout} value mismatch`);
    verified.push(prev);
  }
  return verified;
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
  if (total < required) throw new Error(`Insufficient funds: need ${required}, have ${total} across ${utxos.length} UTXOs`);
  return { selected, total };
}

async function actorUtxos(
  provider: EsploraChainProvider,
  utxoProvider: EsploraUtxoProvider,
  actorAddress: string,
  requireConfirmed: boolean,
): Promise<ChainUtxo[]> {
  const tip = await provider.getBestHeight();
  const discovered = await utxoProvider.getUtxos(actorAddress, tip);
  const verified = await verifyUtxos(provider, discovered);
  if (requireConfirmed) {
    const confirmed = verified.filter((u) => u.confirmations >= 1);
    assert(confirmed.length > 0, `no CONFIRMED UTXOs for actor ${actorAddress}`);
    return confirmed;
  }
  assert(verified.length > 0, `no verified UTXOs for actor ${actorAddress}`);
  return verified;
}

async function resolveSignedTxInputs(provider: EsploraChainProvider, signedHex: string): Promise<BitcoinProtocolTx> {
  const tx = decodeRawTransaction(signedHex, "mainnet");
  for (const input of tx.inputs) {
    if (input.prevTxid === "0".repeat(64)) continue;
    const prev = await provider.getPrevout(input.prevTxid, input.vout);
    if (!prev) throw new Error(`input ${input.prevTxid}:${input.vout} prevout not found on mainnet`);
    input.prevScriptPubKeyHex = prev.scriptPubKeyHex;
    input.prevValueSats = prev.valueSats;
  }
  return tx;
}

/** Pure Cove validation of a signed canary tx against the CURRENT canonical state. */
function validateCanary(cfg: CoveConfig, state: CoveState, btcTx: BitcoinProtocolTx, expectedOp: Exclude<CanaryAction, "DONE">): { ok: boolean; reason?: string } {
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
  const opMap = { DEPLOY: "deploy", MINT: "mint", TRANSFER: "transfer" } as const;
  if (decoded.envelope!.op !== opMap[expectedOp]) return { ok: false, reason: `expected ${expectedOp}, got ${decoded.envelope!.op}` };
  const mapped = toCoveTransaction(btcTx, decoded.envelope!, 0);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  const result = validateCoveOperation(state, mapped.tx, cfg);
  return { ok: result.valid, reason: result.reason ?? undefined };
}

async function waitConfirmation(provider: EsploraChainProvider, txid: string): Promise<{ height: number; hash: string; txIndex: number }> {
  for (let i = 0; i < 180; i++) {
    const st = await provider.getTxStatus(txid);
    if (st?.confirmed && st.blockHeight !== undefined && st.blockHash) {
      const block = await provider.getBlock(st.blockHash);
      const idx = block.txids.indexOf(txid);
      if (idx >= 0) return { height: st.blockHeight, hash: st.blockHash, txIndex: idx };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for confirmation of ${txid}`);
}

async function indexBlock(provider: EsploraChainProvider, indexer: CoveIndexer, height: number, hash: string): Promise<void> {
  const block = await provider.getBlock(hash);
  const txs: BitcoinProtocolTx[] = [];
  for (let i = 0; i < block.rawTxs.length; i++) {
    const raw = block.rawTxs[i]!;
    let tx: BitcoinProtocolTx;
    try {
      tx = decodeRawTransaction(raw, "mainnet");
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
  indexer.processBlock(height, txs);
}

async function main(): Promise<void> {
  const confirmMainnet = process.argv.includes("--confirm-mainnet");
  const ticker = (optionalEnv("COVE_MAINNET_CANARY_TICKER") ?? "COVE").toUpperCase();
  assert(/^[A-Z0-9]{4}$/.test(ticker), `ticker must match [A-Z0-9]{4}, got "${ticker}"`);

  const treasury = decodeMainnetCustodyAddress(requireEnv("COVE_MAINNET_TREASURY_ADDRESS"));
  const settlement = decodeMainnetCustodyAddress(requireEnv("COVE_MAINNET_SETTLEMENT_ADDRESS"));
  const actorAddress = requireEnv("COVE_MAINNET_ACTOR_ADDRESS");
  const recipientAddress = requireEnv("COVE_MAINNET_RECIPIENT_ADDRESS");
  const actorScript = bitcoin.address.toOutputScript(actorAddress, bitcoin.networks.bitcoin).toString("hex");
  const recipientScript = bitcoin.address.toOutputScript(recipientAddress, bitcoin.networks.bitcoin).toString("hex");

  // Activation height H must already be committed as a FUTURE height.
  const hRaw = optionalEnv("COVE_V1_MAINNET_GENESIS_HEIGHT");
  assert(!!hRaw && /^\d+$/.test(hRaw), "COVE_V1_MAINNET_GENESIS_HEIGHT (future activation height H) is required and must be a positive integer.");
  const H = Number.parseInt(hRaw!, 10);
  assert(H >= 1, "activation height H must be >= 1");

  const cfg = makeCoveMainnetConfig({ genesisHeight: H, settlementScript: settlement.scriptPubKeyHex, treasuryScript: treasury.scriptPubKeyHex });

  const provider = new EsploraChainProvider(ESPLORA, "mainnet");

  const tip = await provider.getBestHeight();
  assert(tip >= H, `chain tip ${tip} is below activation height ${H}. Wait for H before running the canary.`);

  console.log(`✓ treasury   ${treasury.address} (${treasury.type})`);
  console.log(`✓ settlement ${settlement.address} (${settlement.type})`);
  console.log(`✓ actor      ${actorAddress}`);
  console.log(`✓ recipient  ${recipientAddress}`);
  console.log(`✓ activation height H=${H} (committed BEFORE canary; tip=${tip})`);

  const loaded = loadManifest();
  const manifest: CanaryManifest = loaded
    ? { ...loaded, ticker, activationHeight: H, treasuryAddress: treasury.address, settlementAddress: settlement.address, actorAddress, recipientAddress }
    : {
        protocol: "cove-mainnet-canary",
        network: "mainnet",
        ticker,
        activationHeight: H,
        treasuryAddress: treasury.address,
        settlementAddress: settlement.address,
        actorAddress,
        recipientAddress,
      };
  saveManifest(manifest);

  // Canonical replay from H → tip (this IS the "restart" reconstruction).
  const indexer = new CoveIndexer(cfg);
  let indexedHeight = H - 1;
  for (let h = H; h <= tip; h++) {
    await indexBlock(provider, indexer, h, await provider.getBlockHash(h));
    indexedHeight = h;
  }
  console.log(`✓ replayed canonical state ${H} → ${tip}`);

  const action = decideNextCanaryAction(indexer.getState(), manifest);

  if (action === "DONE") {
    await finalize(provider, manifest, indexer, cfg, indexedHeight);
    return;
  }

  const signedHex = readSignedHex();
  if (!signedHex) {
    await buildAndExport(action, manifest, cfg, actorScript, recipientScript);
    return;
  }

  // Import + validate (+ broadcast under --confirm-mainnet).
  await importAndBroadcast(action, signedHex, manifest, cfg, indexer, indexedHeight, confirmMainnet);
}

async function buildAndExport(action: Exclude<CanaryAction, "DONE">, manifest: CanaryManifest, cfg: CoveConfig, actorScript: string, recipientScript: string): Promise<void> {
  const provider = new EsploraChainProvider(ESPLORA, "mainnet");
  const utxoProvider = new EsploraUtxoProvider(ESPLORA, "mainnet");
  const feeRate = BigInt(optionalEnv("COVE_MAINNET_FEE_RATE_SATVB") ?? "5");

  let psbt: { psbtBase64: string; unsignedHex: string; feeSats: bigint };
  if (action === "DEPLOY") {
    const coins = selectCoins(await actorUtxos(provider, utxoProvider, manifest.actorAddress, true), cfg.launchFeeSats + feeRate * 200n);
    psbt = buildCoveDeployPsbt({ network: "mainnet", ticker: manifest.ticker, inputs: coins.selected, changeAddress: manifest.actorAddress, feeRateSatVb: feeRate, config: cfg });
  } else if (action === "MINT") {
    const coins = selectCoins(await actorUtxos(provider, utxoProvider, manifest.actorAddress, true), 1_010n + feeRate * 400n);
    psbt = buildCoveMintPsbt({ network: "mainnet", ticker: manifest.ticker, amountAtoms: MINT_AMOUNT_ATOMS, supplyBeforeAtoms: 0n, recipientScriptHex: actorScript, inputs: coins.selected, changeAddress: manifest.actorAddress, feeRateSatVb: feeRate, config: cfg });
  } else {
    const coins = selectCoins(await actorUtxos(provider, utxoProvider, manifest.actorAddress, true), feeRate * 400n);
    psbt = buildCoveTransferPsbt({ network: "mainnet", ticker: manifest.ticker, amountAtoms: TRANSFER_AMOUNT_ATOMS, recipientScriptHex: recipientScript, actorScriptHex: actorScript, inputs: coins.selected, changeAddress: manifest.actorAddress, feeRateSatVb: feeRate, config: cfg });
  }

  const step = stepOf(manifest, action);
  step.unsignedPsbtBase64 = psbt.psbtBase64;
  step.unsignedHex = psbt.unsignedHex;
  step.expectedTxid = localTxid(psbt.unsignedHex);
  step.feeSats = psbt.feeSats.toString();
  step.vsize = bitcoin.Transaction.fromHex(psbt.unsignedHex).virtualSize();
  saveManifest(manifest);

  console.log(`✓ built unsigned ${action} PSBT (no keys held)`);
  console.log(`  txid (deterministic) ${step.expectedTxid}`);
  console.log(`  fee                 ${step.feeSats} sats (${step.vsize} vB)`);
  console.log();
  console.log("EXPORT — sign EXTERNALLY, then re-run with the signed raw tx:");
  console.log(`  Unsigned PSBT (base64):\n${psbt.psbtBase64}\n`);
  console.log(`  Unsigned raw tx (hex):\n${psbt.unsignedHex}\n`);
  console.log(`  COVE_MAINNET_SIGNED_TX=<signed-hex> pnpm cove:mainnet-canary            # validate + summarize`);
  console.log(`  COVE_MAINNET_SIGNED_TX=<signed-hex> pnpm cove:mainnet-canary --confirm-mainnet  # broadcast + confirm`);
  process.exit(0);
}

async function importAndBroadcast(
  action: Exclude<CanaryAction, "DONE">,
  signedHex: string,
  manifest: CanaryManifest,
  cfg: CoveConfig,
  indexer: CoveIndexer,
  indexedHeight: number,
  confirmMainnet: boolean,
): Promise<void> {
  const provider = new EsploraChainProvider(ESPLORA, "mainnet");

  const step = stepOf(manifest, action);
  const txid = localTxid(signedHex);
  if (step.expectedTxid && step.expectedTxid !== txid) {
    throw new Error(`signed tx ${txid} does not match the exported ${action} txid ${step.expectedTxid}.`);
  }

  const tx = await resolveSignedTxInputs(provider, signedHex);
  const v = validateCanary(cfg, indexer.getState(), tx, action);
  assert(v.ok, `Cove ${action} validation failed: ${v.reason}`);

  const fee = computeFee(tx, signedHex);
  assert(fee.feeSats <= cfg.maxMinerFeeSats, `fee ${fee.feeSats} exceeds max ${cfg.maxMinerFeeSats}`);
  assert(!feeRateExceedsCap(fee.feeSats, fee.vsize, cfg.maxFeeRateSatVb), `fee rate exceeds max ${cfg.maxFeeRateSatVb} sat/vB`);

  console.log(`✓ imported + decoded signed ${action} tx`);
  console.log(`  txid     ${txid}`);
  console.log(`  fee      ${fee.feeSats} sats (${fee.vsize} vB, ${fee.feeRate} sat/vB)`);

  if (RPC_URL) {
    const rpc = new CoreRpcProvider({ url: RPC_URL, maxFeeRateSatVb: cfg.maxFeeRateSatVb });
    const info = await rpc.getBlockchainInfo();
    assert(info.chain === "main", `RPC chain is ${info.chain}, expected main`);
    const pre = await rpc.testMempoolAccept(signedHex, cfg.maxFeeRateSatVb);
    assert(pre.allowed, `testmempoolaccept rejected: ${pre.rejectReason ?? "unknown"}`);
    console.log(`✓ testmempoolaccept allowed (chain=${info.chain}, tip=${info.blocks})`);
  } else {
    console.log("⚠ no COVE_MAINNET_RPC_URL set — skipped testmempoolaccept (node-side policy check).");
  }

  if (!confirmMainnet) {
    console.log();
    console.log(`SUMMARY: ${action} is signed, decoded, prevouts resolved, pure-validated, and fee-checked.`);
    console.log("No broadcast occurred. Re-run with --confirm-mainnet to broadcast + confirm.");
    process.exit(0);
  }

  const broadcastTxid = await provider.broadcastTransaction(signedHex);
  assert(broadcastTxid === txid, `broadcast returned ${broadcastTxid}, expected ${txid}`);
  console.log(`✓ broadcast ${txid}`);

  const conf = await waitConfirmation(provider, txid);
  // Catch the indexer up to the confirmation block and assert the event.
  for (let h = indexedHeight + 1; h <= conf.height; h++) {
    await indexBlock(provider, indexer, h, await provider.getBlockHash(h));
  }
  const ev = indexer.getEvents().find((e) => e.txid === txid);
  assert(ev !== undefined && ev.classification === "VALID" && ev.valid && ev.operation === action, `event ${txid} not VALID ${action}: ${ev?.classification} ${ev?.reason}`);

  step.txid = txid;
  step.height = conf.height;
  step.blockHash = conf.hash;
  step.stateRoot = indexer.getStateRoot();
  saveManifest(manifest);
  console.log(`✓ ${action} ${txid} @ ${conf.height} tx=${conf.txIndex} root=${step.stateRoot}`);

  // If this was the final step, finalize; otherwise build+export the next step.
  const next = decideNextCanaryAction(indexer.getState(), manifest);
  if (next === "DONE") {
    await finalize(provider, manifest, indexer, cfg, conf.height);
  } else {
    console.log(`\nNext step: ${next}. Building its unsigned PSBT for external signing…`);
    await buildAndExport(next, manifest, cfg, bitcoin.address.toOutputScript(manifest.actorAddress, bitcoin.networks.bitcoin).toString("hex"), bitcoin.address.toOutputScript(manifest.recipientAddress, bitcoin.networks.bitcoin).toString("hex"));
  }
}

async function finalize(provider: EsploraChainProvider, manifest: CanaryManifest, indexer: CoveIndexer, cfg: CoveConfig, indexedHeight: number): Promise<void> {
  const liveRoot = indexer.getStateRoot();
  const clean = new CoveIndexer(cfg);
  const tip = Math.max(await provider.getBestHeight(), indexedHeight);
  for (let h = cfg.genesisHeight; h <= tip; h++) {
    await indexBlock(provider, clean, h, await provider.getBlockHash(h));
  }
  const replayRoot = clean.getStateRoot();

  manifest.finalStateRoot = liveRoot;
  manifest.replayStateRoot = replayRoot;
  manifest.rootsEqual = liveRoot === replayRoot;
  saveManifest(manifest);

  console.log(`✓ final state root     ${liveRoot}`);
  console.log(`✓ clean replay root    ${replayRoot}`);
  assert(liveRoot === replayRoot, `ROOT MISMATCH: final ${liveRoot} != replay ${replayRoot}`);

  console.log("✓✓ MAINNET CANARY COMPLETE (DEPLOY → MINT → TRANSFER → restart → clean replay) ✓✓");
  console.log(`  DEPLOY   ${manifest.deploy?.txid ?? "?"}`);
  console.log(`  MINT     ${manifest.mint?.txid ?? "?"}`);
  console.log(`  TRANSFER ${manifest.transfer?.txid ?? "?"}`);
  console.log(`  rootsEqual ${manifest.rootsEqual}`);
  console.log();
  console.log("To activate OWNER_CANARY (public writes still closed), set in .env:");
  console.log(`  COVE_V1_MAINNET_GENESIS_HEIGHT=${manifest.activationHeight}`);
  console.log(`  COVE_V1_MAINNET_CANARY_DEPLOY_TXID=${manifest.deploy?.txid ?? ""}`);
  console.log(`  COVE_V1_MAINNET_CANARY_MINT_TXID=${manifest.mint?.txid ?? ""}`);
  console.log(`  COVE_V1_MAINNET_CANARY_TRANSFER_TXID=${manifest.transfer?.txid ?? ""}`);
  console.log(`  COVE_V1_MAINNET_CANARY_STATE_ROOT=${liveRoot}`);
  console.log(`  COVE_V1_MAINNET_CANARY_REPLAY_ROOT=${replayRoot}`);
  console.log(`  COVE_MAINNET_ENABLED=true`);
  console.log("Only after the FULL canary proof is recorded may you enable COVE_DEPLOY/MINT/TRANSFER_MAINNET_ENABLED.");
  process.exit(0);
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("mainnet-canary failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
