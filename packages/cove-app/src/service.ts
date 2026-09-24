import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { TOKEN_CARRIER_SATS, applyMintV2, applyRedeemV2, type CoveStateV2, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import {
  buildDeployPsbtV3,
  buildMintPsbtV3,
  buildRedeemPsbtV3,
  buildTransferPsbtV2,
  validateAndSignMintTransition,
  validateAndSignRedeemTransition,
  validateFinalizedDeployTransaction,
  validateFinalizedMintTransaction,
  validateFinalizedRedeemTransaction,
  validateFinalizedTransferTransaction,
  RESERVE_ANCHOR_SATS,
  type GuardianV3Signer,
  type ValidatedCoveTransaction,
  type ResolvedInput,
  type GuardianTransitionSigner,
  type TransitionSignRequest,
} from "@crclaunch/cove-guardian/v3";
import { loadCanonicalViewSnapshotFromDb, computeHealth, getTokenUtxosByScriptDb } from "@crclaunch/cove-indexer/v3";
import { grossBuy, grossRedeem, deterministicFee, COVE_FEE_CONFIG } from "@crclaunch/cove-economics";
import { ATOMS_PER_TOKEN, PUBLIC_SUPPLY_ATOMS } from "@crclaunch/curve";
import { canonicalTicker, computeTokenId } from "@crclaunch/cove-wire";
import {
  MarketService,
  defaultMarketConfig,
  mainnetMarketConfig,
  listingIdOf,
  listingMessageToSign,
  cancellationHashOf,
  cancellationMessageToSign,
  getBuyRoutes,
  getSellOptions,
  type ListingV1,
} from "@crclaunch/cove-market";
import { AppError } from "./errors.js";
import type { V3AppConfig, V3Network } from "./config.js";
import { checkCoreAgreement } from "./readiness.js";
import { unsignedTxDigest, parsePsbt, btcNetwork, validateInputSignature } from "./psbt.js";
import { resolveFundingUtxos, type FundingCandidate } from "./funding.js";
import { createTxSession, requireTxSession, updateTxSession } from "./tx-session.js";
import { upsertTokenMetadata, validateMetadata, type TokenMetadataInput } from "./metadata.js";
import { listV3Tokens, getV3TokenDetail, getTokenHolders, getTokenActivity } from "./token-read.js";
import { getWalletPortfolio } from "./wallet-read.js";
import { getV3Status } from "./health.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

export interface LaunchPrepareInput {
  ticker: string;
  displayName: string;
  description: string;
  websiteUrl?: string | null;
  xUrl?: string | null;
  imageUrl?: string | null;
  nonceHex?: string;
}

export interface LaunchPrepareResult {
  tokenId: string;
  ticker: string;
  nonceHex: string;
  policyVersion: number;
  chainIdentity: string;
  publicCapAtoms: bigint;
  totalSupplyAtoms: bigint;
  protocolReserveAtoms: bigint;
  curve: string;
  vaultAnchorSats: bigint;
}

export interface BackingQuote {
  tokenId: string;
  amountAtoms: bigint;
  stateHash: string;
  backingOutpoint: { txid: string; vout: number };
  supplyBeforeAtoms: bigint;
  supplyAfterAtoms: bigint;
  backingBeforeSats: bigint;
  backingAfterSats: bigint;
  grossSats: bigint;
  feeSats: bigint;
  feeBps: bigint;
  indexedHeight: bigint;
  indexedBlockHash: string;
  expiresAtHeight: bigint;
}

export interface RedeemQuote {
  tokenId: string;
  amountAtoms: bigint;
  stateHash: string;
  backingOutpoint: { txid: string; vout: number };
  supplyBeforeAtoms: bigint;
  supplyAfterAtoms: bigint;
  backingBeforeSats: bigint;
  backingAfterSats: bigint;
  grossSats: bigint;
  feeSats: bigint;
  netSats: bigint;
}

export interface IntentV3 {
  operation: "DEPLOY" | "BACKING_BUY" | "REDEEM" | "TRANSFER";
  tokenId: string | null;
  tokenAmountAtoms: bigint | null;
  grossSats: bigint | null;
  protocolFeeSats: bigint | null;
  minerFeeSats: bigint;
  netSats: bigint | null;
  walletScript: string;
  stateHash: string | null;
  unsignedTxDigest: string;
}

interface BackingRow {
  state: CoveStateV2;
  stateHash: string;
  input: ResolvedInput;
}

export class V3AppService {
  readonly market: MarketService;

  constructor(
    readonly db: Database,
    readonly provider: CoreRpcProvider,
    readonly config: V3AppConfig,
    readonly signer: GuardianV3Signer | null,
    readonly transitionSigner: GuardianTransitionSigner | null = null,
    readonly secondaryProvider: CoreRpcProvider | null = null,
  ) {
    this.market = new MarketService(
      db,
      provider,
      config.network === "mainnet"
        ? mainnetMarketConfig({ p2pFeeBps: config.p2pFeeBps ?? 50, feeScript: config.feeScript, maxP2pSettlementSats: config.maxP2pSettlementSats ?? 0n })
        : defaultMarketConfig(config.network, config.feeScript),
    );
  }

  // ── guards ────────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.config.enabled) throw new AppError("APP_DISABLED", "Cove V3 application is disabled");
  }

  private assertNetwork(network: string): V3Network {
    if (network === "mainnet" || network === "mainnet-read-only" || network === "mock") {
      throw new AppError("MAINNET_DISABLED", "mainnet mutation is disabled (Phase 8)");
    }
    return network as V3Network;
  }

  private assertMutating(network: string): V3Network {
    this.assertEnabled();
    const n = this.assertNetwork(network);
    return n;
  }

  /** Canary wallet/token allowlist enforcement (§45/§46) — fail closed when set. */
  private assertCanaryAllowed(params: { tokenId?: string; walletScript?: string }): void {
    if (this.config.canaryAllowedTokenIds && params.tokenId && !this.config.canaryAllowedTokenIds.includes(params.tokenId)) {
      throw new AppError("CANARY_TOKEN_NOT_ALLOWED", `token ${params.tokenId} is not in the canary allowlist`);
    }
    if (this.config.canaryAllowedWalletScripts && params.walletScript && !this.config.canaryAllowedWalletScripts.includes(params.walletScript.toLowerCase())) {
      throw new AppError("CANARY_WALLET_NOT_ALLOWED", "wallet script is not in the canary allowlist");
    }
  }

  private requireSigner(): GuardianV3Signer {
    if (!this.signer) throw new AppError("GUARDIAN_UNAVAILABLE", "Guardian signer is not configured");
    return this.signer;
  }

  private async requireHealthy(): Promise<void> {
    const health = await computeHealth({ db: this.db, network: this.config.network, provider: this.provider });
    if (health.health === "REBUILDING") throw new AppError("INDEXER_REBUILDING", "indexer is rebuilding");
    if (health.health === "DIVERGED") throw new AppError("INDEXER_DIVERGED", "indexer diverged from Core tip");
    if (health.health === "CORE_UNREACHABLE") throw new AppError("CORE_UNAVAILABLE", "Bitcoin Core unreachable");
    if (health.health === "BEHIND") throw new AppError("INDEXER_UNHEALTHY", "indexer behind by " + health.lag);
    // Two-Core quorum (§29/§38): if a secondary Core is configured, mutations
    // fail closed unless the two nodes agree.
    if (this.secondaryProvider) {
      const agreement = await checkCoreAgreement(this.provider, this.secondaryProvider);
      if (!agreement.agreed) throw new AppError("CORE_UNAVAILABLE", `Core disagreement: ${agreement.detail ?? "unknown"}`);
    }
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  status() {
    return getV3Status({ db: this.db, provider: this.provider, config: this.config });
  }
  listTokens(opts?: { ticker?: string; search?: string; limit?: number }) {
    return listV3Tokens(this.db, this.config.network, opts);
  }
  tokenDetail(tokenId: string) {
    return getV3TokenDetail(this.db, this.config.network, tokenId);
  }
  tokenHolders(tokenId: string, limit?: number) {
    return getTokenHolders(this.db, this.config.network, tokenId, limit);
  }
  tokenActivity(tokenId: string, limit?: number) {
    return getTokenActivity(this.db, this.config.network, tokenId, limit);
  }
  walletPortfolio(walletScript: string) {
    return getWalletPortfolio(this.db, this.config.network, walletScript);
  }

  // ── backing state loader ──────────────────────────────────────────────────

  private async loadBacking(tokenId: string): Promise<BackingRow> {
    const rows = await this.db
      .select()
      .from(schema.coveV3BackingStates)
      .where(and(eq(schema.coveV3BackingStates.network, this.config.network), eq(schema.coveV3BackingStates.tokenId, tokenId), eq(schema.coveV3BackingStates.canonical, true)));
    const b = rows[0];
    if (!b) throw new AppError("TOKEN_NOT_FOUND", "token not found");
    const state: CoveStateV2 = {
      stateVersion: b.stateVersion as 2,
      policyVersion: b.policyVersion,
      tokenId: b.tokenId,
      issuedPublicSupplyAtoms: b.issuedSupplyAtoms,
      backingSats: b.backingSats,
      curveStage: b.curveStage,
    };
    return {
      state,
      stateHash: b.stateHash,
      input: { txid: b.txid, vout: b.vout, script: Buffer.from(b.scriptPubKey, "hex"), valueSats: b.btcValue },
    };
  }

  private async loadView(tokenId: string, relevantOutpoints: { txid: string; vout: number }[] = []): Promise<CoveCanonicalView> {
    return loadCanonicalViewSnapshotFromDb({ db: this.db, network: this.config.network, tokenId, relevantOutpoints });
  }

  // ── launch ────────────────────────────────────────────────────────────────

  prepareLaunch(input: LaunchPrepareInput): LaunchPrepareResult {
    this.assertEnabled();
    const ticker = canonicalTicker(input.ticker);
    const nonce = input.nonceHex ? Buffer.from(input.nonceHex, "hex") : randomBytes(32);
    if (nonce.length !== 32) throw new AppError("TOKEN_AMOUNT_INVALID", "nonce must be 32 bytes");
    const tokenId = computeTokenId({ chainIdentity: this.config.chainIdentity, policyVersion: 3, ticker, tokenNonce: nonce }).toString("hex");
    validateMetadata({ displayName: input.displayName, description: input.description, websiteUrl: input.websiteUrl, xUrl: input.xUrl, imageUrl: input.imageUrl });
    return {
      tokenId,
      ticker,
      nonceHex: nonce.toString("hex"),
      policyVersion: 3,
      chainIdentity: this.config.chainIdentity,
      publicCapAtoms: PUBLIC_SUPPLY_ATOMS,
      totalSupplyAtoms: 1_000_000_000n * ATOMS_PER_TOKEN,
      protocolReserveAtoms: 160_000_000n * ATOMS_PER_TOKEN,
      curve: "geometric20",
      vaultAnchorSats: RESERVE_ANCHOR_SATS,
    };
  }

  async buildLaunch(params: {
    network: string;
    ticker: string;
    nonceHex: string;
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    minerFeeSats: bigint;
    metadata: TokenMetadataInput;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3; tokenId: string }> {
    this.assertMutating(params.network);
    await this.requireHealthy();
    const tokenId = computeTokenId({ chainIdentity: this.config.chainIdentity, policyVersion: 3, ticker: canonicalTicker(params.ticker), tokenNonce: Buffer.from(params.nonceHex, "hex") }).toString("hex");
    this.assertCanaryAllowed({ tokenId, walletScript: params.walletScript });
    const resolved = await resolveFundingUtxos(this.provider, params.funding);
    for (const f of resolved) {
      if (f.script.toString("hex") !== params.walletScript) throw new AppError("FUNDING_INPUT_INVALID", "funding input script does not match wallet");
    }
    const deployerInputs: ResolvedInput[] = resolved.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: f.valueSats }));
    const result = buildDeployPsbtV3({
      network: btcNetwork(this.config.network),
      identity: { chainIdentity: this.config.chainIdentity, policyVersion: 3, ticker: canonicalTicker(params.ticker), tokenNonce: Buffer.from(params.nonceHex, "hex") },
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      deployerInputs,
      deployerChangeScript: Buffer.from(params.walletScript, "hex"),
      minerFeeSats: params.minerFeeSats,
    });
    const psbtBase64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    const session = await createTxSession(this.db, {
      network: this.config.network,
      operation: "DEPLOY",
      tokenId,
      walletScript: params.walletScript,
      walletAddress: params.walletAddress,
      stateHash: null,
      backingTxid: null,
      backingVout: null,
      unsignedTxDigest: digest,
      psbtBase64,
      status: "BUILT",
      expiresAtHeight: null,
      idempotencyKey: params.idempotencyKey,
    });
    await upsertTokenMetadata({ db: this.db, network: this.config.network, tokenId, submittedByScript: params.walletScript, deployTxid: null, metadata: params.metadata });
    return {
      sessionId: session.id,
      psbtBase64,
      tokenId,
      intent: {
        operation: "DEPLOY",
        tokenId,
        tokenAmountAtoms: 0n,
        grossSats: null,
        protocolFeeSats: null,
        minerFeeSats: params.minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: null,
        unsignedTxDigest: digest,
      },
    };
  }

  async submitLaunch(params: { sessionId: string; signedPsbtBase64: string }): Promise<{ txid: string }> {
    this.assertEnabled();
    const session = await requireTxSession(this.db, params.sessionId);
    if (session.operation !== "DEPLOY") throw new AppError("SESSION_STATE_INVALID", "session is not DEPLOY");
    if (session.status === "BROADCAST" || session.status === "CONFIRMED") return { txid: session.txid! };
    const psbt = parsePsbt(params.signedPsbtBase64, btcNetwork(this.config.network));
    if (unsignedTxDigest(psbt) !== session.unsignedTxDigest) throw new AppError("PSBT_MUTATED", "unsigned tx digest changed");
    for (let i = 0; i < psbt.data.inputs.length; i++) validateInputSignature(psbt, i);
    psbt.finalizeAllInputs();
    const rawTxHex = psbt.extractTransaction().toHex();
    const validated = validateFinalizedDeployTransaction({
      rawTxHex,
      network: this.config.network,
      chainIdentity: this.config.chainIdentity,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
    });
    if (!("rawTxHex" in validated)) throw new AppError("GUARDIAN_REJECTED", validated.reason);
    const txid = await this.broadcast(validated);
    await updateTxSession(this.db, session.id, { txid, status: "BROADCAST" });
    return { txid };
  }

  // ── backing buy ───────────────────────────────────────────────────────────

  async quoteBackingBuy(tokenId: string, amountAtoms: bigint): Promise<BackingQuote> {
    if (amountAtoms <= 0n || amountAtoms % ATOMS_PER_TOKEN !== 0n) throw new AppError("TOKEN_AMOUNT_INVALID", "backing buy requires whole display tokens");
    const backing = await this.loadBacking(tokenId);
    const supply = backing.state.issuedPublicSupplyAtoms;
    if (supply + amountAtoms > PUBLIC_SUPPLY_ATOMS) throw new AppError("TOKEN_AMOUNT_INVALID", "exceeds public cap");
    const gross = grossBuy(supply / ATOMS_PER_TOKEN, amountAtoms / ATOMS_PER_TOKEN);
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.buyFeeBps);
    const next = applyMintV2(backing.state, amountAtoms).nextState;
    const cursor = await this.db.select().from(schema.coveV3Cursor).where(eq(schema.coveV3Cursor.network, this.config.network));
    const c = cursor[0];
    return {
      tokenId,
      amountAtoms,
      stateHash: backing.stateHash,
      backingOutpoint: { txid: backing.input.txid, vout: backing.input.vout },
      supplyBeforeAtoms: supply,
      supplyAfterAtoms: next.issuedPublicSupplyAtoms,
      backingBeforeSats: backing.state.backingSats,
      backingAfterSats: next.backingSats,
      grossSats: gross,
      feeSats: fee,
      feeBps: COVE_FEE_CONFIG.buyFeeBps,
      indexedHeight: c?.height ?? 0n,
      indexedBlockHash: c?.blockHash ?? "",
      expiresAtHeight: (c?.height ?? 0n) + 2n,
    };
  }

  async buildBackingBuy(params: {
    network: string;
    tokenId: string;
    amountAtoms: bigint;
    quoteBinding: { stateHash: string; backingOutpoint: { txid: string; vout: number }; expiresAtHeight: bigint | null };
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    minerFeeSats: bigint;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating(params.network);
    await this.requireHealthy();
    this.assertCanaryAllowed({ tokenId: params.tokenId, walletScript: params.walletScript });
    const signer = this.requireSigner();
    if (params.minerFeeSats > this.config.maxMinerFeeSats) throw new AppError("TOKEN_AMOUNT_INVALID", "miner fee exceeds cap");
    const backing = await this.loadBacking(params.tokenId);
    if (backing.stateHash !== params.quoteBinding.stateHash || backing.input.txid !== params.quoteBinding.backingOutpoint.txid || backing.input.vout !== params.quoteBinding.backingOutpoint.vout) {
      throw new AppError("QUOTE_STALE", "backing state changed since quote");
    }
    const resolved = await resolveFundingUtxos(this.provider, params.funding);
    for (const f of resolved) {
      if (f.script.toString("hex") !== params.walletScript) throw new AppError("FUNDING_INPUT_INVALID", "funding input script does not match wallet");
    }
    const buyerInputs: ResolvedInput[] = resolved.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: f.valueSats }));
    const result = buildMintPsbtV3({
      network: btcNetwork(this.config.network),
      tokenId: Buffer.from(params.tokenId, "hex"),
      prevState: backing.state,
      prevBacking: backing.input,
      mintAmountAtoms: params.amountAtoms,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      buyerInputs,
      buyerCarrierScript: Buffer.from(params.walletScript, "hex"),
      buyerChangeScript: Buffer.from(params.walletScript, "hex"),
      feeScript: this.config.feeScript,
      minerFeeSats: params.minerFeeSats,
    });
    const view = await this.loadView(params.tokenId);
    const req: TransitionSignRequest = { psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript, maxMinerFeeSats: this.config.maxMinerFeeSats };
    const signed = this.transitionSigner
      ? await this.transitionSigner.signMint(req)
      : validateAndSignMintTransition({ signer, psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
          recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript });
    if (!signed.ok) throw new AppError("GUARDIAN_REJECTED", `${signed.reason}: ${signed.detail}`);
    const psbtBase64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    const session = await createTxSession(this.db, {
      network: this.config.network,
      operation: "BACKING_BUY",
      tokenId: params.tokenId,
      walletScript: params.walletScript,
      walletAddress: params.walletAddress,
      stateHash: backing.stateHash,
      backingTxid: backing.input.txid,
      backingVout: backing.input.vout,
      unsignedTxDigest: digest,
      psbtBase64,
      status: "BUILT",
      expiresAtHeight: params.quoteBinding.expiresAtHeight,
      idempotencyKey: params.idempotencyKey,
    });
    return {
      sessionId: session.id,
      psbtBase64,
      intent: {
        operation: "BACKING_BUY",
        tokenId: params.tokenId,
        tokenAmountAtoms: params.amountAtoms,
        grossSats: result.grossSats,
        protocolFeeSats: result.buyFeeSats,
        minerFeeSats: params.minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: backing.stateHash,
        unsignedTxDigest: digest,
      },
    };
  }

  async submitBackingBuy(params: { sessionId: string; signedPsbtBase64: string }): Promise<{ txid: string }> {
    this.assertEnabled();
    const session = await requireTxSession(this.db, params.sessionId);
    if (session.operation !== "BACKING_BUY") throw new AppError("SESSION_STATE_INVALID", "session is not BACKING_BUY");
    if (session.status === "BROADCAST" || session.status === "CONFIRMED") return { txid: session.txid! };
    const psbt = parsePsbt(params.signedPsbtBase64, btcNetwork(this.config.network));
    if (unsignedTxDigest(psbt) !== session.unsignedTxDigest) throw new AppError("PSBT_MUTATED", "unsigned tx digest changed");
    for (let i = 1; i < psbt.data.inputs.length; i++) validateInputSignature(psbt, i);
    // Finalize only the buyer BTC inputs; input 0 is the backing vault, which the
    // Guardian already finalized (its finalScriptWitness is set at build time).
    for (let i = 1; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);
    const rawTxHex = psbt.extractTransaction().toHex();
    const view = await this.loadView(session.tokenId!);
    const validated = validateFinalizedMintTransaction({
      rawTxHex,
      view,
      network: this.config.network,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      feeScript: this.config.feeScript,
      maxMinerFeeSats: this.config.maxMinerFeeSats,
    });
    if (!("rawTxHex" in validated)) throw new AppError("GUARDIAN_REJECTED", validated.reason);
    const txid = await this.broadcast(validated);
    await updateTxSession(this.db, session.id, { txid, status: "BROADCAST" });
    return { txid };
  }

  // ── redeem ────────────────────────────────────────────────────────────────

  async quoteRedeem(tokenId: string, amountAtoms: bigint): Promise<RedeemQuote> {
    if (amountAtoms <= 0n || amountAtoms % ATOMS_PER_TOKEN !== 0n) throw new AppError("TOKEN_AMOUNT_INVALID", "redeem requires whole display tokens");
    const backing = await this.loadBacking(tokenId);
    const gross = grossRedeem(backing.state.issuedPublicSupplyAtoms / ATOMS_PER_TOKEN, amountAtoms / ATOMS_PER_TOKEN);
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.redeemFeeBps);
    const next = applyRedeemV2(backing.state, amountAtoms).nextState;
    return {
      tokenId,
      amountAtoms,
      stateHash: backing.stateHash,
      backingOutpoint: { txid: backing.input.txid, vout: backing.input.vout },
      supplyBeforeAtoms: backing.state.issuedPublicSupplyAtoms,
      supplyAfterAtoms: next.issuedPublicSupplyAtoms,
      backingBeforeSats: backing.state.backingSats,
      backingAfterSats: next.backingSats,
      grossSats: gross,
      feeSats: fee,
      netSats: gross - fee,
    };
  }

  async buildRedeem(params: {
    network: string;
    tokenId: string;
    amountAtoms: bigint;
    walletScript: string;
    walletAddress: string | null;
    minerFeeSats: bigint;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating(params.network);
    await this.requireHealthy();
    this.assertCanaryAllowed({ tokenId: params.tokenId, walletScript: params.walletScript });
    const signer = this.requireSigner();
    const backing = await this.loadBacking(params.tokenId);
    const tokenUtxos = await getTokenUtxosByScriptDb(this.db, this.config.network, params.walletScript);
    const mine = tokenUtxos.filter((u) => u.tokenId === params.tokenId);
    const total = mine.reduce((s, u) => s + u.amountAtoms, 0n);
    if (total < params.amountAtoms) throw new AppError("TOKEN_AMOUNT_INVALID", "insufficient token balance");
    // deterministic token input selection: smallest sufficient first
    const sorted = [...mine].sort((a, b) => (a.amountAtoms !== b.amountAtoms ? (a.amountAtoms < b.amountAtoms ? -1 : 1) : a.txid < b.txid ? -1 : 1));
    const selected = sorted.filter((u) => u.amountAtoms >= 0n).slice(0, Math.min(sorted.length, 4));
    const tokenInputs: ResolvedInput[] = selected.map((u) => ({ txid: u.txid, vout: u.vout, script: Buffer.from(u.scriptPubKey, "hex"), valueSats: TOKEN_CARRIER_SATS }));
    const tokenInputTotalAtoms = selected.reduce((s, u) => s + u.amountAtoms, 0n);
    // REDEEM funding: the seller's token carriers + the backing vault cover the
    // deterministic R-delta payout; the frozen builder has no separate funder.
    const result = buildRedeemPsbtV3({
      network: btcNetwork(this.config.network),
      tokenId: Buffer.from(params.tokenId, "hex"),
      prevState: backing.state,
      prevBacking: backing.input,
      redeemAmountAtoms: params.amountAtoms,
      tokenInputs,
      tokenInputTotalAtoms,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      sellerPayoutScript: Buffer.from(params.walletScript, "hex"),
      sellerChangeScript: Buffer.from(params.walletScript, "hex"),
      feeScript: this.config.feeScript,
      minerFeeSats: params.minerFeeSats,
    });
    const view = await this.loadView(params.tokenId, selected.map((u) => ({ txid: u.txid, vout: u.vout })));
    const req: TransitionSignRequest = { psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript, maxMinerFeeSats: this.config.maxMinerFeeSats };
    const signed = this.transitionSigner
      ? await this.transitionSigner.signRedeem(req)
      : validateAndSignRedeemTransition({ signer, psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
          recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript });
    if (!signed.ok) throw new AppError("GUARDIAN_REJECTED", `${signed.reason}: ${signed.detail}`);
    const psbtBase64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    const session = await createTxSession(this.db, {
      network: this.config.network,
      operation: "REDEEM",
      tokenId: params.tokenId,
      walletScript: params.walletScript,
      walletAddress: params.walletAddress,
      stateHash: backing.stateHash,
      backingTxid: backing.input.txid,
      backingVout: backing.input.vout,
      unsignedTxDigest: digest,
      psbtBase64,
      status: "BUILT",
      expiresAtHeight: null,
      idempotencyKey: params.idempotencyKey,
    });
    return {
      sessionId: session.id,
      psbtBase64,
      intent: {
        operation: "REDEEM",
        tokenId: params.tokenId,
        tokenAmountAtoms: params.amountAtoms,
        grossSats: result.grossSats,
        protocolFeeSats: result.redeemFeeSats,
        minerFeeSats: params.minerFeeSats,
        netSats: result.netSats,
        walletScript: params.walletScript,
        stateHash: backing.stateHash,
        unsignedTxDigest: digest,
      },
    };
  }

  async submitRedeem(params: { sessionId: string; signedPsbtBase64: string }): Promise<{ txid: string }> {
    this.assertEnabled();
    const session = await requireTxSession(this.db, params.sessionId);
    if (session.operation !== "REDEEM") throw new AppError("SESSION_STATE_INVALID", "session is not REDEEM");
    if (session.status === "BROADCAST" || session.status === "CONFIRMED") return { txid: session.txid! };
    const psbt = parsePsbt(params.signedPsbtBase64, btcNetwork(this.config.network));
    if (unsignedTxDigest(psbt) !== session.unsignedTxDigest) throw new AppError("PSBT_MUTATED", "unsigned tx digest changed");
    for (let i = 1; i < psbt.data.inputs.length; i++) validateInputSignature(psbt, i);
    // Finalize only the seller token inputs; input 0 is the backing vault (Guardian-finalized).
    for (let i = 1; i < psbt.data.inputs.length; i++) psbt.finalizeInput(i);
    const rawTxHex = psbt.extractTransaction().toHex();
    const view = await this.loadView(session.tokenId!);
    const validated = validateFinalizedRedeemTransaction({
      rawTxHex,
      view,
      network: this.config.network,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      feeScript: this.config.feeScript,
      maxMinerFeeSats: this.config.maxMinerFeeSats,
    });
    if (!("rawTxHex" in validated)) throw new AppError("GUARDIAN_REJECTED", validated.reason);
    const txid = await this.broadcast(validated);
    await updateTxSession(this.db, session.id, { txid, status: "BROADCAST" });
    return { txid };
  }

  // ── transfer ──────────────────────────────────────────────────────────────

  async buildTransfer(params: {
    network: string;
    tokenId: string;
    amountAtoms: bigint;
    recipientScript: string;
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    minerFeeSats: bigint;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating(params.network);
    await this.requireHealthy();
    const tokenUtxos = await getTokenUtxosByScriptDb(this.db, this.config.network, params.walletScript);
    const mine = tokenUtxos.filter((u) => u.tokenId === params.tokenId);
    const total = mine.reduce((s, u) => s + u.amountAtoms, 0n);
    if (total < params.amountAtoms) throw new AppError("TOKEN_AMOUNT_INVALID", "insufficient token balance");
    const sorted = [...mine].sort((a, b) => (a.amountAtoms !== b.amountAtoms ? (a.amountAtoms < b.amountAtoms ? -1 : 1) : a.txid < b.txid ? -1 : 1));
    const selected = sorted.slice(0, Math.min(sorted.length, 4));
    const tokenInputs: ResolvedInput[] = selected.map((u) => ({ txid: u.txid, vout: u.vout, script: Buffer.from(u.scriptPubKey, "hex"), valueSats: TOKEN_CARRIER_SATS }));
    const tokenInputTotalAtoms = selected.reduce((s, u) => s + u.amountAtoms, 0n);
    const changeAtoms = tokenInputTotalAtoms - params.amountAtoms;
    const tokenOutputs = [{ script: Buffer.from(params.recipientScript, "hex"), amountAtoms: params.amountAtoms }];
    if (changeAtoms > 0n) tokenOutputs.push({ script: Buffer.from(params.walletScript, "hex"), amountAtoms: changeAtoms });
    const resolved = await resolveFundingUtxos(this.provider, params.funding);
    const funderInputs: ResolvedInput[] = resolved.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: f.valueSats }));
    const result = buildTransferPsbtV2({
      network: btcNetwork(this.config.network),
      tokenId: Buffer.from(params.tokenId, "hex"),
      tokenInputs,
      tokenInputTotalAtoms,
      tokenOutputs,
      funderInputs,
      funderChangeScript: Buffer.from(params.walletScript, "hex"),
      btcOutputs: [],
      minerFeeSats: params.minerFeeSats,
    });
    const psbtBase64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    const session = await createTxSession(this.db, {
      network: this.config.network,
      operation: "TRANSFER",
      tokenId: params.tokenId,
      walletScript: params.walletScript,
      walletAddress: params.walletAddress,
      stateHash: null,
      backingTxid: null,
      backingVout: null,
      unsignedTxDigest: digest,
      psbtBase64,
      status: "BUILT",
      expiresAtHeight: null,
      idempotencyKey: params.idempotencyKey,
    });
    return {
      sessionId: session.id,
      psbtBase64,
      intent: {
        operation: "TRANSFER",
        tokenId: params.tokenId,
        tokenAmountAtoms: params.amountAtoms,
        grossSats: null,
        protocolFeeSats: null,
        minerFeeSats: params.minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: null,
        unsignedTxDigest: digest,
      },
    };
  }

  async submitTransfer(params: { sessionId: string; signedPsbtBase64: string }): Promise<{ txid: string }> {
    this.assertEnabled();
    const session = await requireTxSession(this.db, params.sessionId);
    if (session.operation !== "TRANSFER") throw new AppError("SESSION_STATE_INVALID", "session is not TRANSFER");
    if (session.status === "BROADCAST" || session.status === "CONFIRMED") return { txid: session.txid! };
    const psbt = parsePsbt(params.signedPsbtBase64, btcNetwork(this.config.network));
    if (unsignedTxDigest(psbt) !== session.unsignedTxDigest) throw new AppError("PSBT_MUTATED", "unsigned tx digest changed");
    for (let i = 0; i < psbt.data.inputs.length; i++) validateInputSignature(psbt, i);
    psbt.finalizeAllInputs();
    const rawTxHex = psbt.extractTransaction().toHex();
    const view = await this.loadView(session.tokenId!);
    const validated = validateFinalizedTransferTransaction({ rawTxHex, view, maxMinerFeeSats: this.config.maxMinerFeeSats });
    if (!("rawTxHex" in validated)) throw new AppError("GUARDIAN_REJECTED", validated.reason);
    const txid = await this.broadcast(validated);
    await updateTxSession(this.db, session.id, { txid, status: "BROADCAST" });
    return { txid };
  }

  // ── tx status ─────────────────────────────────────────────────────────────

  async txStatus(txid: string) {
    const rows = await this.db.select().from(schema.coveV3AppTransactions).where(and(eq(schema.coveV3AppTransactions.network, this.config.network), eq(schema.coveV3AppTransactions.txid, txid)));
    const session = rows[0] ?? null;
    let mempool = false;
    try {
      await this.provider.getRawTransaction(txid);
      mempool = true;
    } catch {
      mempool = false;
    }
    let confirmedHeight: bigint | null = null;
    const evRows = await this.db.select().from(schema.coveV3Events).where(and(eq(schema.coveV3Events.network, this.config.network), eq(schema.coveV3Events.txid, txid), eq(schema.coveV3Events.canonical, true)));
    if (evRows.length > 0) confirmedHeight = evRows[0]!.blockHeight;
    return { txid, session, mempool, confirmedHeight };
  }

  // ── reconcile app sessions (worker) ───────────────────────────────────────

  async reconcileAppSessions(): Promise<{ confirmed: number }> {
    let confirmed = 0;
    const pending = await this.db
      .select()
      .from(schema.coveV3AppTransactions)
      .where(and(eq(schema.coveV3AppTransactions.network, this.config.network), eq(schema.coveV3AppTransactions.status, "BROADCAST")));
    for (const s of pending) {
      if (!s.txid) continue;
      const ev = await this.db
        .select()
        .from(schema.coveV3Events)
        .where(and(eq(schema.coveV3Events.network, this.config.network), eq(schema.coveV3Events.txid, s.txid), eq(schema.coveV3Events.canonical, true)));
      if (ev.length > 0) {
        await updateTxSession(this.db, s.id, { status: "CONFIRMED" });
        confirmed++;
      } else {
        // not yet confirmed; check mempool — if absent, mark FAILED (evicted)
        try {
          await this.provider.getRawTransaction(s.txid);
        } catch {
          await updateTxSession(this.db, s.id, { status: "FAILED", errorCode: "MEMPOOL_EVICTED" });
        }
      }
    }
    return { confirmed };
  }

  // ── market (P2P) ──────────────────────────────────────────────────────────

  async prepareListing(params: {
    tokenId: string;
    sourceTxid: string;
    sourceVout: number;
    amountAtoms: bigint;
    totalPriceSats: bigint;
    expiryHeight: bigint;
    walletScript: string;
    nonceHex: string;
  }): Promise<{ listing: ListingV1; listingId: string; message: string }> {
    this.assertEnabled();
    const utxoRows = await this.db
      .select()
      .from(schema.coveV3TokenUtxos)
      .where(
        and(
          eq(schema.coveV3TokenUtxos.network, this.config.network),
          eq(schema.coveV3TokenUtxos.txid, params.sourceTxid),
          eq(schema.coveV3TokenUtxos.vout, params.sourceVout),
          eq(schema.coveV3TokenUtxos.tokenId, params.tokenId),
          eq(schema.coveV3TokenUtxos.scriptPubKey, params.walletScript),
          eq(schema.coveV3TokenUtxos.canonical, true),
          isNull(schema.coveV3TokenUtxos.spentByTxid),
        ),
      );
    const u = utxoRows[0];
    if (!u) throw new AppError("LISTING_NOT_FOUND", "source token UTXO not found or spent");
    if (params.amountAtoms > u.amountAtoms) throw new AppError("TOKEN_AMOUNT_INVALID", "listed amount exceeds source UTXO");
    const cursor = await this.db.select().from(schema.coveV3Cursor).where(eq(schema.coveV3Cursor.network, this.config.network));
    const tip = cursor[0]?.height ?? 0n;
    const nonce = Buffer.from(params.nonceHex, "hex");
    if (nonce.length !== 32) throw new AppError("TOKEN_AMOUNT_INVALID", "nonce must be 32 bytes");
    const listing: ListingV1 = {
      orderVersion: 1,
      chainIdentity: this.config.chainIdentity,
      tokenId: params.tokenId,
      sellerTokenScript: params.walletScript,
      sellerPayoutScript: params.walletScript,
      sellerTokenChangeScript: params.walletScript,
      sourceTxid: params.sourceTxid,
      sourceVout: params.sourceVout,
      sourceAmountAtoms: u.amountAtoms,
      amountAtoms: params.amountAtoms,
      totalPriceSats: params.totalPriceSats,
      creationHeight: tip,
      expiryHeight: params.expiryHeight,
      nonce: nonce.toString("hex"),
    };
    const listingId = listingIdOf(listing);
    return { listing, listingId, message: listingMessageToSign(listing) };
  }

  createListing(listing: ListingV1, signatureB64: string) {
    return this.market.createListing({ ...listing, signatureB64 });
  }

  prepareCancellation(listingId: string, nonceHex: string) {
    const cancelNonce = Buffer.from(nonceHex, "hex");
    if (cancelNonce.length !== 32) throw new AppError("TOKEN_AMOUNT_INVALID", "nonce must be 32 bytes");
    const c = { version: 1 as const, listingId, cancelNonce: cancelNonce.toString("hex") };
    return { cancelNonce: c.cancelNonce, cancelHash: cancellationHashOf(c), message: cancellationMessageToSign(c) };
  }

  cancelListing(listingId: string, nonceHex: string, signatureB64: string) {
    return this.market.cancelListing(listingId, Buffer.from(nonceHex, "hex").toString("hex"), signatureB64);
  }

  reserveListing(input: Parameters<MarketService["reserveListing"]>[0]) {
    return this.market.reserveListing(input);
  }
  buildFillPsbt(fillId: string, minerFeeSats: bigint) {
    return this.market.buildFillPsbt(fillId, minerFeeSats);
  }
  submitBuyerSignature(fillId: string, psbtB64: string) {
    return this.market.submitBuyerSignedPsbt(fillId, psbtB64);
  }
  submitSellerSignature(fillId: string, psbtB64: string) {
    return this.market.submitSellerSignedPsbt(fillId, psbtB64);
  }
  finalizeFill(fillId: string) {
    return this.market.finalizeP2PFill(fillId);
  }
  broadcastFill(validated: Parameters<MarketService["broadcastP2PFill"]>[0]) {
    return this.market.broadcastP2PFill(validated);
  }
  getFill(fillId: string) {
    return this.db.select().from(schema.coveV3MarketFills).where(eq(schema.coveV3MarketFills.id, fillId));
  }
  async finalizeAndBroadcastFill(fillId: string): Promise<{ txid: string }> {
    const validated = await this.market.finalizeP2PFill(fillId);
    return this.market.broadcastP2PFill(validated);
  }
  getBuyRoutes(tokenId: string, amountAtoms: bigint) {
    return getBuyRoutes(this.db, this.config.network, tokenId, amountAtoms);
  }
  getSellOptions(tokenId: string, walletScript: string) {
    return getSellOptions(this.db, this.config.network, tokenId, walletScript);
  }
  async listListings(opts: { tokenId?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 100, 200);
    const cond = opts.tokenId ? and(eq(schema.coveV3MarketListings.network, this.config.network), eq(schema.coveV3MarketListings.status, "ACTIVE"), eq(schema.coveV3MarketListings.tokenId, opts.tokenId)) : and(eq(schema.coveV3MarketListings.network, this.config.network), eq(schema.coveV3MarketListings.status, "ACTIVE"));
    return this.db.select().from(schema.coveV3MarketListings).where(cond).limit(limit);
  }

  // ── broadcast boundary ────────────────────────────────────────────────────

  private async broadcast(validated: ValidatedCoveTransaction): Promise<string> {
    const accept = await this.provider.testMempoolAccept(validated.rawTxHex);
    if (!accept.allowed) throw new AppError("MEMPOOL_REJECTED", accept.rejectReason ?? "testmempoolaccept rejected");
    const txid = await this.provider.broadcastTransaction(validated.rawTxHex);
    if (txid !== validated.txid) throw new AppError("BROADCAST_FAILED", "broadcast txid mismatch");
    return txid;
  }
}
