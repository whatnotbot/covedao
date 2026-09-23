import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CoreRpcProvider,
  EsploraChainProvider,
  bitcoin,
  decodeRawTransaction,
  parseCanonicalOpReturn,
  type BitcoinProtocolTx,
  type ChainUtxo,
} from "@crclaunch/bitcoin";
import {
  buildCoveDeployPsbt,
  createCoveState,
  decodeCoveEnvelope,
  isCoveMagic,
  toCoveTransaction,
  validateCoveOperation,
  type CoveConfig,
} from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";
import { computeFee, feeRateExceedsCap } from "./signet-proof.js";
import { decodeMainnetCustodyAddress } from "./mainnet-custody.js";

/**
 * Cove V1 MAINNET CANARY — a no-keys release-candidate rehearsal of the DEPLOY
 * lifecycle against real mainnet.
 *
 * This tool NEVER holds a private key. It builds an unsigned PSBT, exports it,
 * imports the externally-signed transaction, and only broadcasts under an
 * explicit `--confirm-mainnet` flag. It is resumable by local txid via a
 * WIF-free manifest, so a lost RPC response can never cause a double spend.
 */

const ESPLORA = process.env.COVE_MAINNET_ESPLORA_URL || "https://blockstream.info/api";
const RPC_URL = process.env.COVE_MAINNET_RPC_URL || "";
const MANIFEST_PATH = fileURLToPath(new URL("../../../.cove-mainnet-canary.json", import.meta.url));
const MAX_FEE_RATE_SATVB = 50n;
const MAX_MINER_FEE_SATS = 50_000n;

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

interface CanaryManifest {
  protocol: "cove-mainnet-canary";
  network: "mainnet";
  ticker: string;
  treasuryAddress: string;
  settlementAddress: string;
  changeAddress: string;
  fundingTxid: string;
  fundingVout: number;
  actorScriptHex: string;
  unsignedPsbtBase64: string;
  unsignedHex: string;
  expectedTxid: string;
  feeSats: string;
  vsize: number;
  status: "BUILT" | "SIGNED" | "BROADCAST" | "CONFIRMED";
  canaryTxid?: string;
  canaryHeight?: number;
  stateRoot?: string;
}

function loadManifest(): CanaryManifest | undefined {
  if (!existsSync(MANIFEST_PATH)) return undefined;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as CanaryManifest;
}

function saveManifest(m: CanaryManifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
}

/** Derive a deterministic txid locally, independent of witness data. */
function localTxid(hex: string): string {
  return bitcoin.Transaction.fromHex(hex).getId();
}

function makeConfig(genesisHeight: number, treasuryScript: string, settlementScript: string): CoveConfig {
  return {
    network: "mainnet",
    genesisHeight,
    settlementScript,
    treasuryScript,
    launchFeeSats: 10_000n,
    primaryMintFeeBps: 100n,
    minContributionSats: 1_000n,
    maxFeeRateSatVb: MAX_FEE_RATE_SATVB,
    maxMinerFeeSats: MAX_MINER_FEE_SATS,
  };
}

/** Pure Cove validation of the canary DEPLOY against an EMPTY state. */
function validateCanary(cfg: CoveConfig, btcTx: BitcoinProtocolTx): { ok: boolean; reason?: string } {
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
  if (decoded.envelope!.op !== "deploy") return { ok: false, reason: "NOT_DEPLOY" };
  const mapped = toCoveTransaction(btcTx, decoded.envelope!, 0);
  if (!mapped.ok) return { ok: false, reason: mapped.reason };
  const result = validateCoveOperation(createCoveState(), mapped.tx, cfg);
  return { ok: result.valid, reason: result.reason ?? undefined };
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

async function resolvePrevout(provider: EsploraChainProvider, txid: string, vout: number): Promise<ChainUtxo> {
  const prev = await provider.getPrevout(txid, vout);
  if (!prev) throw new Error(`funding UTXO ${txid}:${vout} not found on mainnet`);
  return prev;
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

async function indexConfirmedBlock(
  provider: EsploraChainProvider,
  indexer: CoveIndexer,
  height: number,
  hash: string,
): Promise<void> {
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

function main(): void {
  const confirmMainnet = process.argv.includes("--confirm-mainnet");
  const ticker = (optionalEnv("COVE_MAINNET_CANARY_TICKER") ?? "COVE").toUpperCase();
  assert(/^[A-Z0-9]{4}$/.test(ticker), `ticker must match [A-Z0-9]{4}, got "${ticker}"`);

  // Decode owner custody scripts with mainnet parameters (fail-closed).
  const treasury = decodeMainnetCustodyAddress(requireEnv("COVE_MAINNET_TREASURY_ADDRESS"));
  const settlement = decodeMainnetCustodyAddress(requireEnv("COVE_MAINNET_SETTLEMENT_ADDRESS"));
  console.log(`✓ treasury   ${treasury.address} (${treasury.type})`);
  console.log(`✓ settlement ${settlement.address} (${settlement.type})`);

  const signedHex = optionalEnv("COVE_MAINNET_SIGNED_TX") ?? readSignedFile();
  const signedPsbt = optionalEnv("COVE_MAINNET_SIGNED_PSBT");

  if (!signedHex && !signedPsbt) {
    // ── BUILD (no keys): construct + export the unsigned DEPLOY PSBT ────────
    const fundingTxid = requireEnv("COVE_MAINNET_FUND_TXID");
    const fundingVout = Number.parseInt(requireEnv("COVE_MAINNET_FUND_VOUT"), 10);
    const changeAddress = requireEnv("COVE_MAINNET_CHANGE_ADDRESS");
    const feeRate = BigInt(optionalEnv("COVE_MAINNET_FEE_RATE_SATVB") ?? "2");

    buildExport({
      ticker,
      treasury,
      settlement,
      fundingTxid,
      fundingVout,
      changeAddress,
      feeRate,
    }).catch((e) => {
      console.error("mainnet-canary (BUILD) failed:", e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
    return;
  }

  importAndVerify({
    confirmMainnet,
    ticker,
    treasury,
    settlement,
    signedHex,
    signedPsbt,
  }).catch((e) => {
    console.error("mainnet-canary (IMPORT) failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

function readSignedFile(): string | undefined {
  const path = optionalEnv("COVE_MAINNET_SIGNED_TX_FILE");
  if (!path) return undefined;
  if (!existsSync(path)) throw new Error(`COVE_MAINNET_SIGNED_TX_FILE does not exist: ${path}`);
  return readFileSync(path, "utf8").trim();
}

async function buildExport(p: {
  ticker: string;
  treasury: ReturnType<typeof decodeMainnetCustodyAddress>;
  settlement: ReturnType<typeof decodeMainnetCustodyAddress>;
  fundingTxid: string;
  fundingVout: number;
  changeAddress: string;
  feeRate: bigint;
}): Promise<void> {
  const provider = new EsploraChainProvider(ESPLORA, "mainnet");

  // Resolve the funding UTXO's authoritative script + value from chain. The
  // actor (input 0's spent-UTXO script) is derived here — never from a key.
  const prev = await resolvePrevout(provider, p.fundingTxid, p.fundingVout);
  assert(prev.confirmations === undefined || prev.confirmations >= 0, "unexpected prevout shape");
  const actorScriptHex = prev.scriptPubKeyHex;
  const changeScript = bitcoin.address.toOutputScript(p.changeAddress, bitcoin.networks.bitcoin);
  assert(
    changeScript.toString("hex") === actorScriptHex,
    `change address ${p.changeAddress} does not match the funding UTXO script ${actorScriptHex}. ` +
      "The canary change must return to the actor's own script.",
  );

  const cfg = makeConfig(-1, p.treasury.scriptPubKeyHex, p.settlement.scriptPubKeyHex);
  const psbt = buildCoveDeployPsbt({
    network: "mainnet",
    ticker: p.ticker,
    inputs: [{ txid: p.fundingTxid, vout: p.fundingVout, scriptPubKeyHex: actorScriptHex, valueSats: prev.valueSats, confirmations: prev.confirmations }],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRate,
    config: cfg,
  });

  const manifest: CanaryManifest = {
    protocol: "cove-mainnet-canary",
    network: "mainnet",
    ticker: p.ticker,
    treasuryAddress: p.treasury.address,
    settlementAddress: p.settlement.address,
    changeAddress: p.changeAddress,
    fundingTxid: p.fundingTxid,
    fundingVout: p.fundingVout,
    actorScriptHex,
    unsignedPsbtBase64: psbt.psbtBase64,
    unsignedHex: psbt.unsignedHex,
    expectedTxid: localTxid(psbt.unsignedHex),
    feeSats: psbt.feeSats.toString(),
    vsize: bitcoin.Transaction.fromHex(psbt.unsignedHex).virtualSize(),
    status: "BUILT",
  };
  saveManifest(manifest);

  console.log("✓ built unsigned DEPLOY PSBT (no keys held)");
  console.log(`  actor (input 0)  ${actorScriptHex}`);
  console.log(`  funding          ${p.fundingTxid}:${p.fundingVout} (${prev.valueSats} sats)`);
  console.log(`  txid (deterministic) ${manifest.expectedTxid}`);
  console.log(`  fee              ${psbt.feeSats} sats (${manifest.vsize} vB)`);
  console.log(`  OP_RETURN        ${psbt.opReturnHex}`);
  console.log();
  console.log("EXPORT — sign EXTERNALLY, then import the signed raw tx:");
  console.log("  Unsigned PSBT (base64):");
  console.log(psbt.psbtBase64);
  console.log();
  console.log("  Unsigned raw tx (hex):");
  console.log(psbt.unsignedHex);
  console.log();
  console.log("Import with:  COVE_MAINNET_SIGNED_TX=<signed-hex> pnpm cove:mainnet-canary");
  console.log("Broadcast with:  COVE_MAINNET_SIGNED_TX=<signed-hex> pnpm cove:mainnet-canary --confirm-mainnet");
  console.log("MAINNET ACTIVATION HEIGHT: REQUIRED LATER (set COVE_V1_MAINNET_GENESIS_HEIGHT to the canary's confirmation height).");
  process.exit(0);
}

async function importAndVerify(p: {
  confirmMainnet: boolean;
  ticker: string;
  treasury: ReturnType<typeof decodeMainnetCustodyAddress>;
  settlement: ReturnType<typeof decodeMainnetCustodyAddress>;
  signedHex: string | undefined;
  signedPsbt: string | undefined;
}): Promise<void> {
  const provider = new EsploraChainProvider(ESPLORA, "mainnet");

  let signedHex = p.signedHex;
  if (!signedHex && p.signedPsbt) {
    const psbt = bitcoin.Psbt.fromBase64(p.signedPsbt, { network: bitcoin.networks.bitcoin });
    try {
      psbt.finalizeAllInputs();
      signedHex = psbt.extractTransaction().toHex();
    } catch (e) {
      throw new Error(`signed PSBT is not final (all inputs must be finalized): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!signedHex) throw new Error("COVE_MAINNET_SIGNED_TX (or COVE_MAINNET_SIGNED_PSBT) is required for import.");

  const txid = localTxid(signedHex);
  const manifest = loadManifest();
  if (manifest && manifest.expectedTxid && manifest.expectedTxid !== txid) {
    throw new Error(`signed tx ${txid} does not match the exported txid ${manifest.expectedTxid}.`);
  }

  // Resolve every input's prevout (actor = input 0's spent-UTXO script).
  const tx = await resolveSignedTxInputs(provider, signedHex);
  const actorScriptHex = tx.inputs[0]?.prevScriptPubKeyHex;
  if (!actorScriptHex) throw new Error("input 0 prevout script not resolved");

  const cfg = makeConfig(-1, p.treasury.scriptPubKeyHex, p.settlement.scriptPubKeyHex);
  const v = validateCanary(cfg, tx);
  assert(v.ok, `Cove canary validation failed: ${v.reason}`);

  const fee = computeFee(tx, signedHex);
  assert(fee.feeSats <= MAX_MINER_FEE_SATS, `fee ${fee.feeSats} exceeds max ${MAX_MINER_FEE_SATS}`);
  assert(!feeRateExceedsCap(fee.feeSats, fee.vsize, MAX_FEE_RATE_SATVB), `fee rate exceeds max ${MAX_FEE_RATE_SATVB} sat/vB`);

  console.log("✓ imported + decoded signed tx");
  console.log(`  txid            ${txid}`);
  console.log(`  actor (input 0) ${actorScriptHex}`);
  console.log(`  fee             ${fee.feeSats} sats`);
  console.log(`  vsize           ${fee.vsize} vB`);
  console.log(`  fee rate        ${fee.feeRate} sat/vB`);

  // Optional Core RPC preflight (testmempoolaccept) when a node is configured.
  if (RPC_URL) {
    const rpc = new CoreRpcProvider({ url: RPC_URL, maxFeeRateSatVb: MAX_FEE_RATE_SATVB });
    const info = await rpc.getBlockchainInfo();
    assert(info.chain === "main", `RPC chain is ${info.chain}, expected main`);
    const pre = await rpc.testMempoolAccept(signedHex, MAX_FEE_RATE_SATVB);
    if (!pre.allowed) throw new Error(`testmempoolaccept rejected: ${pre.rejectReason ?? "unknown"}`);
    console.log(`✓ testmempoolaccept allowed (chain=${info.chain}, tip=${info.blocks})`);
  } else {
    console.log("⚠ no COVE_MAINNET_RPC_URL set — skipped testmempoolaccept (node-side policy check).");
  }

  if (!p.confirmMainnet) {
    console.log();
    console.log("SUMMARY: canary DEPLOY is built, signed, decoded, prevouts resolved, pure-validated, and fee-checked.");
    console.log("No broadcast occurred. Re-run with --confirm-mainnet to broadcast + confirm + index.");
    console.log("MAINNET ACTIVATION HEIGHT: REQUIRED LATER");
    process.exit(0);
  }

  // ── EXPLICIT owner-approved broadcast ──────────────────────────────────────
  const broadcastTxid = await provider.broadcastTransaction(signedHex);
  assert(broadcastTxid === txid, `broadcast returned ${broadcastTxid}, expected ${txid}`);
  console.log(`✓ broadcast ${txid}`);

  const conf = await waitConfirmation(provider, txid);
  console.log(`✓ confirmed @ ${conf.height} tx=${conf.txIndex}`);

  // Index the confirmation block with a genesis bound equal to the canary's own
  // height (this DEPLOY is the first Cove op on mainnet).
  const indexCfg = makeConfig(conf.height, p.treasury.scriptPubKeyHex, p.settlement.scriptPubKeyHex);
  const indexer = new CoveIndexer(indexCfg);
  await indexConfirmedBlock(provider, indexer, conf.height, conf.hash);

  const ev = indexer.getEvents().find((e) => e.txid === txid);
  assert(ev !== undefined && ev.classification === "VALID" && ev.valid && ev.operation === "DEPLOY", `event ${txid} not VALID DEPLOY: ${ev?.classification} ${ev?.reason}`);
  const state = indexer.getState();
  const token = state.tokens.get(txid);
  assert(token !== undefined && token.ticker === p.ticker, "canary token not created");
  assert(indexer.getStateRoot() !== "", "empty state root");

  const updated: CanaryManifest = manifest
    ? { ...manifest, status: "CONFIRMED", canaryTxid: txid, canaryHeight: conf.height, stateRoot: indexer.getStateRoot() }
    : {
        protocol: "cove-mainnet-canary",
        network: "mainnet",
        ticker: p.ticker,
        treasuryAddress: p.treasury.address,
        settlementAddress: p.settlement.address,
        changeAddress: optionalEnv("COVE_MAINNET_CHANGE_ADDRESS") ?? "",
        fundingTxid: "",
        fundingVout: 0,
        actorScriptHex,
        unsignedPsbtBase64: "",
        unsignedHex: "",
        expectedTxid: txid,
        feeSats: fee.feeSats.toString(),
        vsize: fee.vsize,
        status: "CONFIRMED",
        canaryTxid: txid,
        canaryHeight: conf.height,
        stateRoot: indexer.getStateRoot(),
      };
  saveManifest(updated);

  console.log();
  console.log("✓✓ MAINNET CANARY COMPLETE ✓✓");
  console.log(`  canary txid   ${txid}`);
  console.log(`  canary height ${conf.height}`);
  console.log(`  state root    ${indexer.getStateRoot()}`);
  console.log();
  console.log("To activate OWNER_CANARY (public writes still closed), set in .env:");
  console.log(`  COVE_V1_MAINNET_GENESIS_HEIGHT=${conf.height}`);
  console.log(`  COVE_V1_MAINNET_CANARY_TXID=${txid}`);
  console.log(`  COVE_MAINNET_ENABLED=true`);
  console.log("Only after the canary is recorded may you enable COVE_DEPLOY/MINT/TRANSFER_MAINNET_ENABLED.");
  process.exit(0);
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error("mainnet-canary failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
