import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { TOKEN_CARRIER_SATS, applyMintV2, applyRedeemV2, stateHashV2, type CoveStateV2, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import {
  buildDeployPsbtV3,
  buildMintPsbtV3,
  buildRedeemPsbtV3,
  buildTransferPsbtV2,
  validateFinalizedDeployTransaction,
  validateFinalizedMintTransaction,
  validateFinalizedRedeemTransaction,
  validateFinalizedTransferTransaction,
  RESERVE_ANCHOR_SATS,
  decodeCoveOpReturnTx,
  type ValidatedCoveTransaction,
  type ResolvedInput,
  type GuardianTransitionSigner,
  type TransitionSignRequest,
} from "@crclaunch/cove-guardian/v3";
import { loadCanonicalViewSnapshotFromDb, computeHealth, getTokenUtxosByScriptDb } from "@crclaunch/cove-indexer/v3";
import { grossBuy, grossRedeem, deterministicFee, stageScaledFlatSats } from "@crclaunch/cove-economics";
import { ATOMS_PER_TOKEN, PUBLIC_SUPPLY_ATOMS } from "@crclaunch/curve";
import { canonicalTicker, computeTokenId, OP_MINT, OP_REDEEM, type ParsedEnvelopeV2 } from "@crclaunch/cove-wire";
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
import { checkCoreAgreement, verifyMainnetGenesis } from "./readiness.js";
import { unsignedTxDigest, parsePsbt, btcNetwork, validateInputSignature, walletDeltaSats } from "./psbt.js";
import { resolveFundingUtxos, type FundingCandidate, type ResolvedFunding } from "./funding.js";
import {
  estimateOperationVsize,
  loadFeeRates,
  resolveMinerFee,
  type CoveOperation,
  type FeeRates,
} from "./fees.js";
import {
  createTxSession,
  requireTxSession,
  updateTxSession,
  findBroadcastSpendOfBacking,
} from "./tx-session.js";
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
  /**
   * The only supply that exists. applyMintV2 caps issuance at PUBLIC_SUPPLY_ATOMS
   * and there is no code path that mints beyond it, so this IS the total — there
   * is no separate protocol reserve to report.
   */
  publicSupplyAtoms: bigint;
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
  /**
   * Net satoshis this transaction adds to (+) or takes from (−) the wallet,
   * measured from the PSBT itself. The browser re-derives the same figure from
   * the price it displayed and refuses to sign if the two disagree.
   */
  walletDeltaSats: bigint;
}

interface BackingRow {
  state: CoveStateV2;
  stateHash: string;
  input: ResolvedInput;
}

/**
 * Token carriers a single REDEEM may consume. Bounds transaction size; a holder
 * whose balance is spread wider consolidates first with a self-transfer.
 */
const MAX_REDEEM_TOKEN_INPUTS = 4;

/** Wire-v2 TRANSFER allows at most four allocations, so at most four carriers. */
const MAX_TRANSFER_TOKEN_INPUTS = 4;

/**
 * How far to chain unconfirmed vault transitions.
 *
 * Bitcoin Core's default mempool policy allows a package of 25 transactions, so
 * a 26th would be rejected as `too-long-mempool-chain`. Stopping one short of
 * the limit leaves room for the buyer's own funding transaction if it is itself
 * unconfirmed.
 */
const MAX_PENDING_BACKING_CHAIN = 24;

/** The successor vault is always output 1 of a MINT or REDEEM. */
const BACKING_SUCCESSOR_VOUT = 1;

/**
 * How long a fee-rate reading stays usable. Short enough that a mempool floor
 * climbing mid-block is picked up before it can strand a transaction.
 */
const FEE_RATE_CACHE_MS = 15_000;

export class V3AppService {
  readonly market: MarketService;
  private feeRatesCache: { at: number; rates: FeeRates } | null = null;

  constructor(
    readonly db: Database,
    readonly provider: CoreRpcProvider,
    readonly config: V3AppConfig,
    readonly transitionSigner: GuardianTransitionSigner,
    readonly secondaryProvider: CoreRpcProvider | null = null,
  ) {
    this.market = new MarketService(
      db,
      provider,
      config.network === "mainnet"
        ? mainnetMarketConfig({ p2pFeeBps: config.p2pFeeBps ?? 50, feeScript: config.feeScript, maxP2pSettlementSats: config.maxP2pSettlementSats ?? 0n, chainIdentity: config.chainIdentity })
        : defaultMarketConfig(config.network, config.feeScript, config.chainIdentity),
    );
  }

  // ── guards ────────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.config.enabled) throw new AppError("APP_DISABLED", "Cove V3 application is disabled");
  }

  private assertNetwork(): V3Network {
    // §P0-5: the network gate MUST come from the server-side config, never from
    // request-body input. A mainnet node is read-only until it is explicitly
    // activated, and that decision is made at boot, not per request.
    if (this.config.network === "mainnet") {
      throw new AppError("MAINNET_DISABLED", "mainnet mutation is disabled (Phase 8)");
    }
    return this.config.network;
  }

  private assertMutating(): V3Network {
    this.assertEnabled();
    return this.assertNetwork();
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
    // §P1-2: verify each node by mainnet genesis hash (not the chain string,
    // which cannot distinguish networks). Fail closed on any mismatch.
    if (this.config.network === "mainnet") {
      if (!(await verifyMainnetGenesis(this.provider))) {
        throw new AppError("CORE_UNAVAILABLE", "primary Core is not on Bitcoin mainnet (genesis hash mismatch)");
      }
      if (this.secondaryProvider && !(await verifyMainnetGenesis(this.secondaryProvider))) {
        throw new AppError("CORE_UNAVAILABLE", "secondary Core is not on Bitcoin mainnet (genesis hash mismatch)");
      }
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
    return this.followPendingBacking(tokenId, await this.loadConfirmedBacking(tokenId));
  }

  private async loadConfirmedBacking(tokenId: string): Promise<BackingRow> {
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
    const confirmed: BackingRow = {
      state,
      stateHash: b.stateHash,
      input: { txid: b.txid, vout: b.vout, script: Buffer.from(b.scriptPubKey, "hex"), valueSats: b.btcValue },
    };
    return confirmed;
  }

  /**
   * The backing state at a specific outpoint, following the unconfirmed chain
   * if that outpoint has not been mined yet. Used when revalidating a
   * transaction against the exact state it was built on.
   */
  private async loadBackingAt(
    tokenId: string,
    txid: string | null,
    vout: number | null,
  ): Promise<BackingRow> {
    const confirmed = await this.loadConfirmedBacking(tokenId);
    if (!txid || vout === null) return this.followPendingBacking(tokenId, confirmed);
    return this.followPendingBacking(tokenId, confirmed, { txid, vout });
  }

  /**
   * Walk forward from the confirmed backing through transitions that are
   * broadcast but not yet mined, and return the tip.
   *
   * The vault is a single chained UTXO, so only one transition can spend it per
   * block. Building every quote on the CONFIRMED state therefore served exactly
   * one buyer per block — everyone else collided and got QUOTE_STALE. Bitcoin
   * happily lets a transaction spend an unconfirmed output (default policy
   * allows a chain of 25), and the Guardian never checks confirmation — it only
   * checks that the new state follows from the old one. Building on the pending
   * tip is what turns one buyer per block into a queue that drains.
   *
   * Each step is re-derived, never trusted: the broadcast transaction is
   * fetched from the node, its envelope decoded, the successor state computed
   * by the same transition functions the validator uses, and the vault output
   * checked against it. Anything that does not line up stops the walk and the
   * last verified state is returned, so a dropped or replaced transaction
   * degrades to today's behaviour rather than producing a bad quote.
   */
  private async followPendingBacking(
    tokenId: string,
    confirmed: BackingRow,
    stopAt?: { txid: string; vout: number },
  ): Promise<BackingRow> {
    let tip = confirmed;

    for (let depth = 0; depth < MAX_PENDING_BACKING_CHAIN; depth++) {
      // Submitting a transaction revalidates it against the outpoint it was
      // BUILT on, which may be behind the current tip if others have queued
      // since. Stopping there keeps the check exact.
      if (stopAt && tip.input.txid === stopAt.txid && tip.input.vout === stopAt.vout) return tip;
      const next = await findBroadcastSpendOfBacking(
        this.db,
        this.config.network,
        tokenId,
        tip.input.txid,
        tip.input.vout,
      );
      if (!next?.txid) return tip;

      let raw: string;
      try {
        raw = await this.provider.getRawTransaction(next.txid);
      } catch {
        // Gone from mempool and never mined. Stop here; the session reconciler
        // owns marking it failed.
        return tip;
      }

      const tx = bitcoin.Transaction.fromHex(raw);
      let envelope: ParsedEnvelopeV2;
      try {
        envelope = decodeCoveOpReturnTx(tx);
      } catch {
        return tip;
      }

      let nextState: CoveStateV2;
      if (envelope.op === OP_MINT) {
        nextState = applyMintV2(tip.state, envelope.amount).nextState;
      } else if (envelope.op === OP_REDEEM) {
        nextState = applyRedeemV2(tip.state, envelope.redeemAmount).nextState;
      } else {
        // TRANSFER and DEPLOY never move the vault.
        return tip;
      }

      const vaultOut = tx.outs[BACKING_SUCCESSOR_VOUT];
      const expectedValue = RESERVE_ANCHOR_SATS + nextState.backingSats;
      if (!vaultOut || BigInt(vaultOut.value) !== expectedValue) return tip;

      tip = {
        state: nextState,
        stateHash: stateHashV2(nextState),
        input: {
          txid: tx.getId(),
          vout: BACKING_SUCCESSOR_VOUT,
          script: Buffer.from(vaultOut.script),
          valueSats: expectedValue,
        },
      };
    }
    return tip;
  }

  /**
   * Present an unconfirmed vault tip to the Guardian as the current backing.
   *
   * The canonical view is built from the indexer, which only sees confirmed
   * blocks. When a transition is already broadcast the builder correctly spends
   * its successor, but the Guardian would then compare that input against the
   * older confirmed outpoint and reject with BACKING_VOUT_MISMATCH. Overlaying
   * the tip keeps the two in agreement.
   *
   * Only the backing is overlaid. Token UTXOs and every other lookup still come
   * from confirmed data, so nothing else is treated as settled before it is.
   */
  private overlayPendingBacking(
    view: CoveCanonicalView,
    tokenIdHex: string,
    tip: BackingRow,
  ): CoveCanonicalView {
    const tipOutpoint = { txid: tip.input.txid, vout: tip.input.vout };
    const matches = (tokenId: Buffer) => tokenId.toString("hex") === tokenIdHex;
    return {
      getBackingOutpoint: (tokenId) =>
        matches(tokenId) ? tipOutpoint : view.getBackingOutpoint(tokenId),
      getCurrentBackingState: (tokenId) =>
        matches(tokenId) ? tip.state : view.getCurrentBackingState(tokenId),
      getBackingStateByOutpoint: (outpoint) =>
        outpoint.txid === tipOutpoint.txid && outpoint.vout === tipOutpoint.vout
          ? tip.state
          : view.getBackingStateByOutpoint(outpoint),
      getTokenUtxo: (outpoint) => view.getTokenUtxo(outpoint),
    };
  }

  private async loadView(tokenId: string, relevantOutpoints: { txid: string; vout: number }[] = []): Promise<CoveCanonicalView> {
    return loadCanonicalViewSnapshotFromDb({ db: this.db, network: this.config.network, tokenId, relevantOutpoints });
  }

  // ── miner fees ────────────────────────────────────────────────────────────

  /**
   * Live fee rates from the node, cached for a few seconds.
   *
   * Every build asks for these, and a browser buying in a hurry will hit this
   * many times a block. The cache is short enough that a rising mempool floor
   * is picked up well within one block.
   */
  async feeRates(): Promise<FeeRates> {
    const now = Date.now();
    if (this.feeRatesCache && now - this.feeRatesCache.at < FEE_RATE_CACHE_MS) {
      return this.feeRatesCache.rates;
    }
    const rates = await loadFeeRates(this.provider);
    this.feeRatesCache = { at: now, rates };
    return rates;
  }

  /**
   * Pick the funding inputs this transaction needs, and size the miner fee to
   * the transaction it will actually produce.
   *
   * Two problems are fixed here at once. Every build used to spend EVERY UTXO
   * in the wallet, so a wallet with fifty of them paid for a ~3,400-vbyte
   * transaction to buy a few dollars of tokens. And the fee was a flat 1,000
   * sats regardless of size, which is under the relay floor for anything but a
   * quiet mempool. Now the smallest sufficient set of inputs is chosen, and
   * the fee follows the size of that exact set.
   *
   * `targetSats` is everything the funding inputs must cover EXCLUDING the
   * miner fee. It may be negative when other inputs (token carriers) already
   * bring in more sats than the outputs consume.
   */
  private async resolveFundingAndFee(params: {
    op: CoveOperation;
    walletScript: string;
    candidates: FundingCandidate[];
    targetSats: bigint;
    tokenInputs?: number;
    recipientCarriers?: number;
    discovery?: boolean;
    feeRateSatPerVb?: bigint;
    explicitMinerFeeSats?: bigint;
  }): Promise<{ inputs: ResolvedInput[]; minerFeeSats: bigint; vsize: number; satPerVb: bigint }> {
    const resolved = await resolveFundingUtxos(this.provider, params.candidates);
    for (const f of resolved) {
      if (f.script.toString("hex") !== params.walletScript) {
        throw new AppError("FUNDING_INPUT_INVALID", "funding input script does not match wallet");
      }
    }
    const rates = await this.feeRates();
    // Neither a rate nor an amount supplied: use the Standard tier. The old
    // default was a flat 1,000 sats regardless of size, which is what made a
    // busy-mempool transaction unconfirmable in the first place.
    const standard = rates.tiers.find((t) => t.key === "standard") ?? rates.tiers[0]!;
    const feeRateSatPerVb =
      params.feeRateSatPerVb ??
      (params.explicitMinerFeeSats === undefined ? standard.satPerVb : undefined);
    const shape = {
      tokenInputs: params.tokenInputs,
      walletScriptBytes: params.walletScript.length / 2,
      feeScriptBytes: this.config.feeScript.length,
      recipientCarriers: params.recipientCarriers,
      discovery: params.discovery,
    };
    const priceAt = (fundingInputs: number) => {
      const vsize = estimateOperationVsize(params.op, { ...shape, fundingInputs });
      const fee = resolveMinerFee({
        rateSatPerVb: feeRateSatPerVb,
        explicitSats: params.explicitMinerFeeSats,
        vsize,
        floorSatPerVb: rates.floorSatPerVb,
        ceilingSatPerVb: rates.ceilingSatPerVb,
        maxMinerFeeSats: this.config.maxMinerFeeSats,
      });
      return { vsize: fee.vsize, minerFeeSats: fee.minerFeeSats, satPerVb: fee.effectiveSatPerVb };
    };

    // Largest-first: reaches the target in the fewest inputs, which is also the
    // cheapest transaction. Ties break on txid/vout so the choice is
    // deterministic and a rebuild produces the same PSBT.
    const sorted = [...resolved].sort((a, b) => {
      if (a.valueSats !== b.valueSats) return a.valueSats > b.valueSats ? -1 : 1;
      if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
      return a.vout - b.vout;
    });

    const toInput = (f: ResolvedFunding): ResolvedInput => ({
      txid: f.txid,
      vout: f.vout,
      script: f.script,
      valueSats: f.valueSats,
    });

    // Zero funding inputs is legitimate when other inputs already cover the
    // outputs and the fee (a redeem whose token carriers pay for themselves).
    const noFunding = priceAt(0);
    if (params.targetSats + noFunding.minerFeeSats <= 0n) {
      return { inputs: [], ...noFunding };
    }

    const chosen: ResolvedFunding[] = [];
    let sum = 0n;
    for (const utxo of sorted) {
      chosen.push(utxo);
      sum += utxo.valueSats;
      const priced = priceAt(chosen.length);
      if (sum >= params.targetSats + priced.minerFeeSats) {
        return { inputs: chosen.map(toInput), ...priced };
      }
    }
    const shortfall = priceAt(Math.max(1, chosen.length));
    throw new AppError(
      "INSUFFICIENT_BTC",
      `wallet has ${sum} sats across ${chosen.length} inputs but ` +
        `${params.targetSats + shortfall.minerFeeSats} is required ` +
        `(${params.targetSats} for the trade, ${shortfall.minerFeeSats} for the miner at ` +
        `${shortfall.satPerVb} sat/vB)`,
    );
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
      publicSupplyAtoms: PUBLIC_SUPPLY_ATOMS,
      curve: "geometric20",
      vaultAnchorSats: RESERVE_ANCHOR_SATS,
    };
  }

  async buildLaunch(params: {
    ticker: string;
    nonceHex: string;
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    /** Preferred: the fee rate the user picked; the server sizes the fee. */
    feeRateSatPerVb?: bigint;
    /** Explicit fee, for callers that size the transaction themselves. */
    minerFeeSats?: bigint;
    metadata: TokenMetadataInput;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3; tokenId: string }> {
    this.assertMutating();
    await this.requireHealthy();
    const tokenId = computeTokenId({ chainIdentity: this.config.chainIdentity, policyVersion: 3, ticker: canonicalTicker(params.ticker), tokenNonce: Buffer.from(params.nonceHex, "hex") }).toString("hex");
    this.assertCanaryAllowed({ tokenId, walletScript: params.walletScript });
    // The deploy funds the vault anchor plus the miner fee, nothing else.
    const { inputs: deployerInputs, minerFeeSats } = await this.resolveFundingAndFee({
      op: "DEPLOY",
      walletScript: params.walletScript,
      candidates: params.funding,
      targetSats: RESERVE_ANCHOR_SATS,
      feeRateSatPerVb: params.feeRateSatPerVb,
      explicitMinerFeeSats: params.minerFeeSats,
    });
    const result = buildDeployPsbtV3({
      network: btcNetwork(this.config.network),
      identity: { chainIdentity: this.config.chainIdentity, policyVersion: 3, ticker: canonicalTicker(params.ticker), tokenNonce: Buffer.from(params.nonceHex, "hex") },
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      deployerInputs,
      deployerChangeScript: Buffer.from(params.walletScript, "hex"),
      minerFeeSats,
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
        minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: null,
        unsignedTxDigest: digest,
        walletDeltaSats: walletDeltaSats(result.psbt, params.walletScript),
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
    const fee = deterministicFee(
      gross,
      this.config.buyFeeBps,
      stageScaledFlatSats(supply / ATOMS_PER_TOKEN, this.config.buyFeeFlatSatsAtTopStage),
    );
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
      feeBps: this.config.buyFeeBps,
      indexedHeight: c?.height ?? 0n,
      indexedBlockHash: c?.blockHash ?? "",
      expiresAtHeight: (c?.height ?? 0n) + 2n,
    };
  }

  async buildBackingBuy(params: {
    tokenId: string;
    amountAtoms: bigint;
    quoteBinding: { stateHash: string; backingOutpoint: { txid: string; vout: number }; expiresAtHeight: bigint | null };
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    /** Preferred: the fee rate the user picked; the server sizes the fee. */
    feeRateSatPerVb?: bigint;
    /** Explicit fee, for callers that size the transaction themselves. */
    minerFeeSats?: bigint;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating();
    await this.requireHealthy();
    this.assertCanaryAllowed({ tokenId: params.tokenId, walletScript: params.walletScript });
    const backing = await this.loadBacking(params.tokenId);
    if (backing.stateHash !== params.quoteBinding.stateHash || backing.input.txid !== params.quoteBinding.backingOutpoint.txid || backing.input.vout !== params.quoteBinding.backingOutpoint.vout) {
      throw new AppError("QUOTE_STALE", "backing state changed since quote");
    }
    // The advisory crc-20 envelope is ticker-keyed; the canonical view resolves
    // tokens by tokenId, so look the ticker up only when the envelope is on.
    const discoveryTicker = this.config.discoveryEnvelope
      ? (await getV3TokenDetail(this.db, this.config.network, params.tokenId))?.ticker
      : undefined;
    // What the buyer's own BTC must cover: the curve price, the protocol fee,
    // and the sats that ride on their new token carrier. The vault input
    // supplies the existing backing and the successor consumes it, so neither
    // appears here.
    const { grossSats: quotedGrossSats } = applyMintV2(backing.state, params.amountAtoms);
    const quotedBuyFeeSats = deterministicFee(
      quotedGrossSats,
      this.config.buyFeeBps,
      stageScaledFlatSats(
        backing.state.issuedPublicSupplyAtoms / ATOMS_PER_TOKEN,
        this.config.buyFeeFlatSatsAtTopStage,
      ),
    );
    const { inputs: buyerInputs, minerFeeSats } = await this.resolveFundingAndFee({
      op: "BACKING_BUY",
      walletScript: params.walletScript,
      candidates: params.funding,
      targetSats: quotedGrossSats + quotedBuyFeeSats + TOKEN_CARRIER_SATS,
      discovery: discoveryTicker !== undefined,
      feeRateSatPerVb: params.feeRateSatPerVb,
      explicitMinerFeeSats: params.minerFeeSats,
    });
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
      minerFeeSats,
      buyFeeBps: this.config.buyFeeBps,
      buyFeeFlatSatsAtTopStage: this.config.buyFeeFlatSatsAtTopStage,
      discoveryEnvelope: discoveryTicker ? { ticker: discoveryTicker } : undefined,
    });
    const view = this.overlayPendingBacking(
      await this.loadView(params.tokenId),
      params.tokenId,
      backing,
    );
    const req: TransitionSignRequest = { psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript, maxMinerFeeSats: this.config.maxMinerFeeSats, buyFeeBps: this.config.buyFeeBps,
      buyFeeFlatSatsAtTopStage: this.config.buyFeeFlatSatsAtTopStage,
      discoveryTicker };
    const signed = await this.transitionSigner.signMint(req);
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
        minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: backing.stateHash,
        unsignedTxDigest: digest,
        walletDeltaSats: walletDeltaSats(result.psbt, params.walletScript),
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
    const view = this.overlayPendingBacking(
      await this.loadView(session.tokenId!),
      session.tokenId!,
      await this.loadBackingAt(session.tokenId!, session.backingTxid, session.backingVout),
    );
    const validated = await validateFinalizedMintTransaction({
      rawTxHex,
      view,
      network: this.config.network,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      feeScript: this.config.feeScript,
      maxMinerFeeSats: this.config.maxMinerFeeSats,
      buyFeeBps: this.config.buyFeeBps,
      buyFeeFlatSatsAtTopStage: this.config.buyFeeFlatSatsAtTopStage,
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
    const fee = deterministicFee(gross, this.config.redeemFeeBps, this.config.redeemFeeFlatSats);
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
    tokenId: string;
    amountAtoms: bigint;
    walletScript: string;
    walletAddress: string | null;
    /** Preferred: the fee rate the user picked; the server sizes the fee. */
    feeRateSatPerVb?: bigint;
    /** Explicit fee, for callers that size the transaction themselves. */
    minerFeeSats?: bigint;
    idempotencyKey: string;
    /** Ordinary BTC utxos the seller offers to pay the miner fee. */
    funding?: FundingCandidate[];
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating();
    await this.requireHealthy();
    this.assertCanaryAllowed({ tokenId: params.tokenId, walletScript: params.walletScript });
    const backing = await this.loadBacking(params.tokenId);
    const tokenUtxos = await getTokenUtxosByScriptDb(this.db, this.config.network, params.walletScript);
    const mine = tokenUtxos.filter((u) => u.tokenId === params.tokenId);
    const total = mine.reduce((s, u) => s + u.amountAtoms, 0n);
    if (total < params.amountAtoms) throw new AppError("TOKEN_AMOUNT_INVALID", "insufficient token balance");
    // Deterministic token input selection: LARGEST first, taking only as many
    // as the amount needs.
    //
    // This previously sorted ascending and then took the first four
    // unconditionally, so the balance check above (which sums EVERY utxo)
    // could pass while the four smallest carriers held less than the amount —
    // the build then failed with "redeem exceeds token input". Largest-first
    // reaches any redeemable amount in the fewest inputs.
    const sorted = [...mine].sort((a, b) =>
      a.amountAtoms !== b.amountAtoms ? (a.amountAtoms > b.amountAtoms ? -1 : 1) : a.txid < b.txid ? -1 : 1,
    );
    const selected: typeof sorted = [];
    let running = 0n;
    for (const u of sorted) {
      if (running >= params.amountAtoms) break;
      if (selected.length >= MAX_REDEEM_TOKEN_INPUTS) break;
      selected.push(u);
      running += u.amountAtoms;
    }
    if (running < params.amountAtoms) {
      throw new AppError(
        "TOKEN_AMOUNT_INVALID",
        `balance is spread across too many outputs: the ${MAX_REDEEM_TOKEN_INPUTS} largest hold ` +
          `${running} atoms, short of ${params.amountAtoms}. Consolidate with a transfer to yourself, ` +
          `or redeem a smaller amount.`,
      );
    }
    const tokenInputs: ResolvedInput[] = selected.map((u) => ({ txid: u.txid, vout: u.vout, script: Buffer.from(u.scriptPubKey, "hex"), valueSats: TOKEN_CARRIER_SATS }));
    const tokenInputTotalAtoms = selected.reduce((s, u) => s + u.amountAtoms, 0n);
    // The vault covers the R-delta payout; the seller funds the miner fee from
    // ordinary BTC so the backing never pays it and a single-carrier partial
    // redeem is possible.
    //
    // The vault pays the seller's BTC out of backing, so the seller's own BTC
    // only has to cover the miner fee and the token-change carrier, less the
    // sats the spent carriers already bring in. That figure is usually
    // negative, which is why zero funding inputs is a legitimate answer.
    const changeCarrierSats = tokenInputTotalAtoms > params.amountAtoms ? TOKEN_CARRIER_SATS : 0n;
    const carrierSatsIn = BigInt(tokenInputs.length) * TOKEN_CARRIER_SATS;
    const { inputs: funderInputs, minerFeeSats } = await this.resolveFundingAndFee({
      op: "REDEEM",
      walletScript: params.walletScript,
      candidates: params.funding ?? [],
      targetSats: changeCarrierSats - carrierSatsIn,
      tokenInputs: tokenInputs.length,
      feeRateSatPerVb: params.feeRateSatPerVb,
      explicitMinerFeeSats: params.minerFeeSats,
    });
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
      minerFeeSats,
      funderInputs,
      funderChangeScript: Buffer.from(params.walletScript, "hex"),
      redeemFeeBps: this.config.redeemFeeBps,
      redeemFeeFlatSats: this.config.redeemFeeFlatSats,
    });
    const view = this.overlayPendingBacking(
      await this.loadView(params.tokenId, selected.map((u) => ({ txid: u.txid, vout: u.vout }))),
      params.tokenId,
      backing,
    );
    const req: TransitionSignRequest = { psbt: result.psbt, view, network: this.config.network, recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile, feeScript: this.config.feeScript, maxMinerFeeSats: this.config.maxMinerFeeSats, redeemFeeBps: this.config.redeemFeeBps,
      redeemFeeFlatSats: this.config.redeemFeeFlatSats };
    const signed = await this.transitionSigner.signRedeem(req);
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
        minerFeeSats,
        netSats: result.netSats,
        walletScript: params.walletScript,
        stateHash: backing.stateHash,
        unsignedTxDigest: digest,
        walletDeltaSats: walletDeltaSats(result.psbt, params.walletScript),
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
    const view = this.overlayPendingBacking(
      await this.loadView(session.tokenId!),
      session.tokenId!,
      await this.loadBackingAt(session.tokenId!, session.backingTxid, session.backingVout),
    );
    const validated = await validateFinalizedRedeemTransaction({
      rawTxHex,
      view,
      network: this.config.network,
      guardianXOnly: this.config.guardianXOnly,
      recoveryKeyXOnly: this.config.recoveryKeyXOnly,
      recoveryProfile: this.config.recoveryProfile,
      feeScript: this.config.feeScript,
      maxMinerFeeSats: this.config.maxMinerFeeSats,
      redeemFeeBps: this.config.redeemFeeBps,
      redeemFeeFlatSats: this.config.redeemFeeFlatSats,
    });
    if (!("rawTxHex" in validated)) throw new AppError("GUARDIAN_REJECTED", validated.reason);
    const txid = await this.broadcast(validated);
    await updateTxSession(this.db, session.id, { txid, status: "BROADCAST" });
    return { txid };
  }

  // ── transfer ──────────────────────────────────────────────────────────────

  async buildTransfer(params: {
    tokenId: string;
    amountAtoms: bigint;
    recipientScript: string;
    walletScript: string;
    walletAddress: string | null;
    funding: FundingCandidate[];
    /** Preferred: the fee rate the user picked; the server sizes the fee. */
    feeRateSatPerVb?: bigint;
    /** Explicit fee, for callers that size the transaction themselves. */
    minerFeeSats?: bigint;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; psbtBase64: string; intent: IntentV3 }> {
    this.assertMutating();
    await this.requireHealthy();
    const tokenUtxos = await getTokenUtxosByScriptDb(this.db, this.config.network, params.walletScript);
    const mine = tokenUtxos.filter((u) => u.tokenId === params.tokenId);
    const total = mine.reduce((s, u) => s + u.amountAtoms, 0n);
    if (total < params.amountAtoms) throw new AppError("TOKEN_AMOUNT_INVALID", "insufficient token balance");
    // Largest-first, taking only what the amount needs. This previously sorted
    // ASCENDING and took the four smallest unconditionally, so the balance
    // check above could pass on a wallet whose four smallest carriers held less
    // than the amount — the transfer then went on to build a negative token
    // change and failed far downstream. Same defect that was fixed in redeem.
    const sorted = [...mine].sort((a, b) =>
      a.amountAtoms !== b.amountAtoms ? (a.amountAtoms > b.amountAtoms ? -1 : 1) : a.txid < b.txid ? -1 : 1,
    );
    const selected: typeof sorted = [];
    let runningAtoms = 0n;
    for (const u of sorted) {
      if (runningAtoms >= params.amountAtoms) break;
      if (selected.length >= MAX_TRANSFER_TOKEN_INPUTS) break;
      selected.push(u);
      runningAtoms += u.amountAtoms;
    }
    if (runningAtoms < params.amountAtoms) {
      throw new AppError(
        "TOKEN_AMOUNT_INVALID",
        `balance is spread across too many outputs: the ${MAX_TRANSFER_TOKEN_INPUTS} largest hold ` +
          `${runningAtoms} atoms, short of ${params.amountAtoms}. Consolidate with a transfer to ` +
          `yourself, or send a smaller amount.`,
      );
    }
    const tokenInputs: ResolvedInput[] = selected.map((u) => ({ txid: u.txid, vout: u.vout, script: Buffer.from(u.scriptPubKey, "hex"), valueSats: TOKEN_CARRIER_SATS }));
    const tokenInputTotalAtoms = selected.reduce((s, u) => s + u.amountAtoms, 0n);
    const changeAtoms = tokenInputTotalAtoms - params.amountAtoms;
    const tokenOutputs = [{ script: Buffer.from(params.recipientScript, "hex"), amountAtoms: params.amountAtoms }];
    if (changeAtoms > 0n) tokenOutputs.push({ script: Buffer.from(params.walletScript, "hex"), amountAtoms: changeAtoms });
    // Carrier outputs cost 1,000 sats each; the carriers being spent bring the
    // same back in. The wallet's own BTC covers the difference and the fee.
    const carrierSatsOut = BigInt(tokenOutputs.length) * TOKEN_CARRIER_SATS;
    const carrierSatsIn = BigInt(tokenInputs.length) * TOKEN_CARRIER_SATS;
    const { inputs: funderInputs, minerFeeSats } = await this.resolveFundingAndFee({
      op: "TRANSFER",
      walletScript: params.walletScript,
      candidates: params.funding,
      targetSats: carrierSatsOut - carrierSatsIn,
      tokenInputs: tokenInputs.length,
      recipientCarriers: tokenOutputs.length,
      feeRateSatPerVb: params.feeRateSatPerVb,
      explicitMinerFeeSats: params.minerFeeSats,
    });
    const result = buildTransferPsbtV2({
      network: btcNetwork(this.config.network),
      tokenId: Buffer.from(params.tokenId, "hex"),
      tokenInputs,
      tokenInputTotalAtoms,
      tokenOutputs,
      funderInputs,
      funderChangeScript: Buffer.from(params.walletScript, "hex"),
      btcOutputs: [],
      minerFeeSats,
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
        minerFeeSats,
        netSats: null,
        walletScript: params.walletScript,
        stateHash: null,
        unsignedTxDigest: digest,
        walletDeltaSats: walletDeltaSats(result.psbt, params.walletScript),
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
    const view = this.overlayPendingBacking(
      await this.loadView(session.tokenId!),
      session.tokenId!,
      await this.loadBackingAt(session.tokenId!, session.backingTxid, session.backingVout),
    );
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
  buildFillPsbt(fillId: string, fee: { feeRateSatPerVb?: bigint; minerFeeSats?: bigint }) {
    return this.market.buildFillPsbt(fillId, fee);
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
    // §P0-6: this was the only mutation with no server-side guard. Gate on
    // enabled + network (config-driven), health/quorum, and the canary
    // allowlist before finalizing or broadcasting anything.
    this.assertMutating();
    await this.requireHealthy();
    const fills = await this.getFill(fillId);
    const fill = fills[0];
    if (!fill) throw new AppError("STATE_CHANGED", "fill not found");
    this.assertCanaryAllowed({ tokenId: fill.tokenId, walletScript: fill.buyerTokenScript });
    const validated = await this.market.finalizeP2PFill(fillId);
    return this.market.broadcastP2PFill(validated);
  }
  getBuyRoutes(tokenId: string, amountAtoms: bigint) {
    return getBuyRoutes(this.db, this.config.network, tokenId, amountAtoms, {
      buyFeeBps: this.config.buyFeeBps,
      p2pFeeBps: this.market.config.p2pFeeBps,
    });
  }
  getSellOptions(tokenId: string, walletScript: string) {
    return getSellOptions(this.db, this.config.network, tokenId, walletScript, this.config.redeemFeeBps);
  }
  /**
   * Active listings, each carrying the ticker of the token it sells.
   *
   * The ticker comes from a left join rather than a second round trip: a market
   * row that shows only a 64-character token id tells a buyer nothing about
   * what they are buying. The join is left, not inner, so a listing whose token
   * row is missing still appears — with a null ticker — instead of silently
   * vanishing from the book.
   */
  async listListings(opts: { tokenId?: string; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 100, 200);
    const base = [
      eq(schema.coveV3MarketListings.network, this.config.network),
      eq(schema.coveV3MarketListings.status, "ACTIVE"),
    ];
    const cond = opts.tokenId
      ? and(...base, eq(schema.coveV3MarketListings.tokenId, opts.tokenId))
      : and(...base);

    const rows = await this.db
      .select({ listing: schema.coveV3MarketListings, ticker: schema.coveV3Tokens.ticker })
      .from(schema.coveV3MarketListings)
      .leftJoin(
        schema.coveV3Tokens,
        and(
          eq(schema.coveV3Tokens.network, schema.coveV3MarketListings.network),
          eq(schema.coveV3Tokens.tokenId, schema.coveV3MarketListings.tokenId),
          // A token row orphaned by a reorg must not supply a ticker.
          eq(schema.coveV3Tokens.canonical, true),
        ),
      )
      .where(cond)
      .limit(limit);

    return rows.map((r) => ({ ...r.listing, ticker: r.ticker }));
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
