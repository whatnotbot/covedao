import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { eq, and, isNull, inArray, lte, desc } from "drizzle-orm";
import { schema, type Database, type DbTransaction } from "@crclaunch/db";
import {
  estimateVsize,
  loadFeeRates,
  resolveMinerFee,
  FeeError,
  type CoreRpcProvider,
} from "@crclaunch/bitcoin";
import { TOKEN_CARRIER_SATS, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import { buildTransferPsbtV2, type ResolvedInput } from "@crclaunch/cove-guardian/v3";
import { loadCanonicalViewSnapshotFromDb } from "@crclaunch/cove-indexer/v3";
import { deterministicFee, dustThreshold } from "@crclaunch/cove-economics";
import { MarketError } from "./errors.js";
import type { MarketConfig } from "./config.js";
import type { ListingV1, CancellationV1 } from "./types.js";
import { listingIdOf, cancellationHashOf } from "./order/hash.js";
import { verifyListingAuthorization, verifyCancellationAuthorization, verifyReservationAuthorization } from "./order/signature.js";
import { validateListingShape } from "./order/validate.js";
import { unsignedTxDigest, parsePsbt, validateP2wpkhPartialSig, partialSigOfInput } from "./psbt.js";
import {
  validateFinalizedP2PFill,
  broadcastValidatedP2PFill,
  assertSettlementCap,
  type ValidatedP2PFill,
  type P2PFillTerms,
} from "./finalize.js";
import { assertMarketReady } from "./health.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

export interface BuyerFundInput {
  txid: string;
  vout: number;
  script: string; // hex
  valueSats: bigint;
}

export interface CreateListingInput extends ListingV1 {
  signatureB64: string;
}

export interface ReserveListingInput {
  listingId: string;
  buyerTokenScript: string; // hex
  buyerChangeScript: string; // hex
  buyerFundInputs: BuyerFundInput[];
  /** 32-byte hex nonce the buyer signed (§M4). */
  reserveNonce: string;
  /** BIP-322 signature over the reservation message (§M4). */
  signatureB64: string;
}

type ListingSelect = typeof schema.coveV3MarketListings.$inferSelect;
type FillSelect = typeof schema.coveV3MarketFills.$inferSelect;

interface SourceResolution {
  scriptPubKey: Buffer;
  amountAtoms: bigint;
  valueSats: bigint;
}

function btcNetwork(network: MarketConfig["network"]): bitcoin.networks.Network {
  // Mainnet must not fall through to testnet parameters (signet and testnet
  // legitimately share them; mainnet does not).
  if (network === "regtest") return bitcoin.networks.regtest;
  if (network === "mainnet") return bitcoin.networks.bitcoin;
  return bitcoin.networks.testnet;
}

function asBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function listingToV1(row: ListingSelect): ListingV1 {
  return {
    orderVersion: row.orderVersion as 1,
    chainIdentity: row.chainIdentity,
    tokenId: row.tokenId,
    sellerTokenScript: row.sellerTokenScript,
    sellerPayoutScript: row.sellerPayoutScript,
    sellerTokenChangeScript: row.sellerTokenChangeScript,
    sourceTxid: row.sourceTxid,
    sourceVout: row.sourceVout,
    sourceAmountAtoms: row.sourceAmountAtoms,
    amountAtoms: row.amountAtoms,
    totalPriceSats: row.totalPriceSats,
    creationHeight: row.creationHeight,
    expiryHeight: row.expiryHeight,
    nonce: row.nonce,
  };
}

/**
 * A P2P fill's OP_RETURN: a wire-v2 TRANSFER with at most two allocations
 * (the buyer's tokens and the seller's change), plus OP_RETURN and its push
 * length.
 */
const P2P_OP_RETURN_SCRIPT_BYTES = 57;

function fillFundInputs(fill: FillSelect): BuyerFundInput[] {
  const raw = fill.buyerFundInputs as unknown as { txid: string; vout: number; script: string; valueSats: string }[];
  return raw.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: BigInt(f.valueSats) }));
}

/**
 * V3-native fixed-price marketplace service (§15-§30). No custody, no private
 * keys server-side, no "send first", no DB-only settlement. Inventory is always
 * re-resolved from the canonical V3 DB + Core at every critical step.
 */
export class MarketService {
  constructor(
    readonly db: Database,
    readonly provider: CoreRpcProvider,
    readonly config: MarketConfig,
  ) {}

  /** Resolve the seller's source token UTXO from the canonical V3 DB + Core. */
  private async resolveSource(listing: ListingV1): Promise<SourceResolution> {
    const rows = await this.db
      .select()
      .from(schema.coveV3TokenUtxos)
      .where(
        and(
          eq(schema.coveV3TokenUtxos.network, this.config.network),
          eq(schema.coveV3TokenUtxos.txid, listing.sourceTxid),
          eq(schema.coveV3TokenUtxos.vout, listing.sourceVout),
          eq(schema.coveV3TokenUtxos.tokenId, listing.tokenId),
          eq(schema.coveV3TokenUtxos.scriptPubKey, listing.sellerTokenScript),
          eq(schema.coveV3TokenUtxos.canonical, true),
          isNull(schema.coveV3TokenUtxos.spentByTxid),
        ),
      );
    if (rows.length !== 1) throw new MarketError("LISTING_BAD_SOURCE", "source token UTXO not canonical/unspent");
    const row = rows[0]!;
    if (row.amountAtoms !== listing.sourceAmountAtoms) {
      throw new MarketError("LISTING_SOURCE_MISMATCH", "source amount mismatch vs indexer");
    }

    // Core gettxout — authoritative unspent + script check (catches mempool spends).
    const txout = await this.provider.getTxout(listing.sourceTxid, listing.sourceVout);
    if (!txout) throw new MarketError("LISTING_SOURCE_SPENT", "source outpoint already spent");
    if (txout.scriptPubKeyHex !== listing.sellerTokenScript) {
      throw new MarketError("LISTING_SOURCE_MISMATCH", "source script mismatch vs Core");
    }
    return { scriptPubKey: asBuffer(listing.sellerTokenScript), amountAtoms: row.amountAtoms, valueSats: txout.valueSats };
  }

  private async loadListing(listingId: string): Promise<ListingSelect | null> {
    const rows = await this.db.select().from(schema.coveV3MarketListings).where(eq(schema.coveV3MarketListings.listingId, listingId));
    return rows[0] ?? null;
  }

  private async loadFill(fillId: string): Promise<FillSelect | null> {
    const rows = await this.db.select().from(schema.coveV3MarketFills).where(eq(schema.coveV3MarketFills.id, fillId));
    return rows[0] ?? null;
  }

  async createListing(input: CreateListingInput): Promise<string> {
    // §M5: a listing must commit to THIS market's chain identity, not another
    // network's (which would let a foreign-chain signature/state pass through).
    if (input.chainIdentity !== this.config.chainIdentity) {
      throw new MarketError("CHAIN_IDENTITY_MISMATCH", `listing chainIdentity ${input.chainIdentity} != server ${this.config.chainIdentity}`);
    }
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });
    validateListingShape(input);

    // A listing must actually expire. `maxListingBlocks` was configured but
    // never enforced, so a seller could sign an ask that stayed fillable
    // forever — and an ask priced months ago is a gift to whoever notices it
    // after the market moves. The window is checked here, at the point the
    // signed order is accepted.
    const listingWindow = input.expiryHeight - input.creationHeight;
    if (listingWindow > this.config.maxListingBlocks) {
      throw new MarketError(
        "LISTING_EXPIRY_TOO_FAR",
        `listing would stay open for ${listingWindow} blocks; the limit is ` +
          `${this.config.maxListingBlocks} (about ${this.config.maxListingBlocks / 144n} days)`,
      );
    }

    if (!verifyListingAuthorization(input, input.signatureB64)) {
      throw new MarketError("LISTING_BAD_SIGNATURE", "listing BIP-322 signature invalid");
    }
    await this.resolveSource(input);

    if (input.totalPriceSats < dustThreshold(asBuffer(input.sellerPayoutScript))) {
      throw new MarketError("SELLER_PAYOUT_DUST", "seller payout below relay dust");
    }
    assertSettlementCap(input.totalPriceSats, this.config.maxP2pSettlementSats);
    const marketFee = deterministicFee(input.totalPriceSats, this.config.p2pFeeBps);
    if (marketFee < dustThreshold(this.config.feeScript)) {
      throw new MarketError("MARKET_FEE_DUST", "p2p fee below relay dust");
    }

    const listingId = listingIdOf(input);
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.coveV3MarketListings)
        .where(eq(schema.coveV3MarketListings.listingId, listingId));
      if (existing.length > 0) throw new MarketError("STATE_CHANGED", "listingId already exists");

      await tx.insert(schema.coveV3MarketListings).values({
        listingId,
        network: this.config.network,
        chainIdentity: input.chainIdentity,
        tokenId: input.tokenId,
        orderVersion: input.orderVersion,
        sellerTokenScript: input.sellerTokenScript,
        sellerPayoutScript: input.sellerPayoutScript,
        sellerTokenChangeScript: input.sellerTokenChangeScript,
        sourceTxid: input.sourceTxid,
        sourceVout: input.sourceVout,
        sourceAmountAtoms: input.sourceAmountAtoms,
        amountAtoms: input.amountAtoms,
        totalPriceSats: input.totalPriceSats,
        creationHeight: input.creationHeight,
        expiryHeight: input.expiryHeight,
        nonce: input.nonce,
        signatureB64: input.signatureB64,
        status: "ACTIVE",
      });
      await tx.insert(schema.coveV3MarketListingInputs).values({
        listingId,
        sourceTxid: input.sourceTxid,
        sourceVout: input.sourceVout,
        amountAtoms: input.sourceAmountAtoms,
        scriptPubKey: input.sellerTokenScript,
      });
      await tx.insert(schema.coveV3MarketEvents).values({
        network: this.config.network,
        listingId,
        eventType: "LISTING_CREATED",
        payloadJson: { amountAtoms: input.amountAtoms.toString(), totalPriceSats: input.totalPriceSats.toString() },
      });
    });
    return listingId;
  }

  async cancelListing(listingId: string, cancelNonce: string, signatureB64: string): Promise<void> {
    const listing = await this.loadListing(listingId);
    if (!listing) throw new MarketError("STATE_CHANGED", "listing not found");
    const cancellation: CancellationV1 = { version: 1, listingId, cancelNonce };
    if (!verifyCancellationAuthorization(listingToV1(listing), cancellation, signatureB64)) {
      throw new MarketError("LISTING_BAD_SIGNATURE", "cancellation BIP-322 signature invalid");
    }
    const cancelHash = cancellationHashOf(cancellation);

    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.coveV3MarketListings)
        .where(eq(schema.coveV3MarketListings.listingId, listingId))
        .for("update");
      const row = rows[0];
      if (!row) throw new MarketError("STATE_CHANGED", "listing not found");
      // A cancelled listing NEVER resurrects (even across reorg).
      if (row.status === "FILLED" || row.status === "CANCELLED") {
        throw new MarketError("LISTING_CANCELLED", `cannot cancel ${row.status} listing`);
      }
      await tx.insert(schema.coveV3MarketCancellations).values({ listingId, cancelHash, cancelNonce, signatureB64 });
      await tx
        .update(schema.coveV3MarketListings)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(schema.coveV3MarketListings.listingId, listingId));
      await tx
        .update(schema.coveV3MarketFills)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(schema.coveV3MarketFills.listingId, listingId),
            inArray(schema.coveV3MarketFills.status, ["RESERVED", "PSBT_BUILT", "BUYER_SIGNED", "SELLER_SIGNED"]),
          ),
        );
      await tx.insert(schema.coveV3MarketEvents).values({
        network: this.config.network,
        listingId,
        eventType: "LISTING_CANCELLED",
        payloadJson: { cancelHash },
      });
    });
  }

  async reserveListing(input: ReserveListingInput): Promise<string> {
    // §M4: require a signed nonce — an unsigned reserve lets anyone lock every
    // listing for free (denial-of-service).
    if (!verifyReservationAuthorization({ version: 1, listingId: input.listingId, reserveNonce: input.reserveNonce, buyerTokenScript: input.buyerTokenScript }, input.signatureB64)) {
      throw new MarketError("LISTING_BAD_SIGNATURE", "reservation BIP-322 signature invalid");
    }
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });
    const tip = BigInt(await this.provider.getBestHeight());

    const fillId = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.coveV3MarketListings)
        .where(eq(schema.coveV3MarketListings.listingId, input.listingId))
        .for("update");
      const row = rows[0];
      if (!row) throw new MarketError("STATE_CHANGED", "listing not found");
      if (row.status !== "ACTIVE") throw new MarketError("LISTING_RESERVED", `listing is ${row.status}`);
      if (row.expiryHeight <= tip) {
        await tx.update(schema.coveV3MarketListings).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, input.listingId));
        throw new MarketError("LISTING_EXPIRED", "listing expired");
      }

      await this.resolveSource(listingToV1(row));

      const marketFee = deterministicFee(row.totalPriceSats, this.config.p2pFeeBps);
      const [inserted] = await tx
        .insert(schema.coveV3MarketFills)
        .values({
          listingId: input.listingId,
          network: this.config.network,
          tokenId: row.tokenId,
          buyerTokenScript: input.buyerTokenScript,
          buyerChangeScript: input.buyerChangeScript,
          buyerFundInputs: input.buyerFundInputs.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: f.valueSats.toString() })),
          amountAtoms: row.amountAtoms,
          totalPriceSats: row.totalPriceSats,
          marketFeeSats: marketFee,
          extraCarrierSats: 0n,
          minerFeeSats: 0n,
          status: "RESERVED",
          reservationExpiresAt: new Date(Date.now() + this.config.reservationTtlSeconds * 1000),
        })
        .returning({ id: schema.coveV3MarketFills.id });

      await tx
        .update(schema.coveV3MarketListings)
        .set({ status: "RESERVED", updatedAt: new Date() })
        .where(eq(schema.coveV3MarketListings.listingId, input.listingId));
      return inserted!.id;
    });

    return fillId;
  }

  /**
   * Build the atomic fill PSBT.
   *
   * `fee` is a RATE by preference: only this method knows how many inputs the
   * buyer reserved and therefore how large the transaction will be. A flat sat
   * amount is still accepted for callers that size their own transaction.
   */
  async buildFillPsbt(
    fillId: string,
    fee: bigint | { feeRateSatPerVb?: bigint; minerFeeSats?: bigint },
  ): Promise<string> {
    const feeInput = typeof fee === "bigint" ? { minerFeeSats: fee } : fee;
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });

    const fill = await this.loadFill(fillId);
    if (!fill) throw new MarketError("STATE_CHANGED", "fill not found");
    if (fill.status !== "RESERVED" && fill.status !== "PSBT_BUILT") throw new MarketError("STATE_CHANGED", `fill is ${fill.status}`);
    const listing = await this.loadListing(fill.listingId);
    if (!listing) throw new MarketError("STATE_CHANGED", "listing not found");

    const source = await this.resolveSource(listingToV1(listing));

    const changeAtoms = listing.sourceAmountAtoms - listing.amountAtoms;
    const tokenOutputs: { script: Buffer; amountAtoms: bigint }[] = [
      { script: asBuffer(fill.buyerTokenScript), amountAtoms: listing.amountAtoms },
    ];
    if (changeAtoms > 0n) {
      tokenOutputs.push({ script: asBuffer(listing.sellerTokenChangeScript), amountAtoms: changeAtoms });
    }
    const extraCarrierSats = BigInt(tokenOutputs.length) * TOKEN_CARRIER_SATS - source.valueSats;
    const marketFee = deterministicFee(listing.totalPriceSats, this.config.p2pFeeBps);
    const btcOutputs = [
      { script: asBuffer(listing.sellerPayoutScript), valueSats: listing.totalPriceSats },
      { script: this.config.feeScript, valueSats: marketFee },
    ];
    const funderInputs: ResolvedInput[] = fillFundInputs(fill).map((f) => ({
      txid: f.txid,
      vout: f.vout,
      script: asBuffer(f.script),
      valueSats: f.valueSats,
    }));

    // Size the fee against the transaction that is actually about to exist:
    // one token-carrier input plus however many UTXOs the buyer reserved, and
    // every output already decided above. A flat fee here would mean a fill
    // that either never confirms or overpays by a multiple.
    const rates = await loadFeeRates(this.provider);
    const standard = rates.tiers.find((t) => t.key === "standard") ?? rates.tiers[0]!;
    const vsize = estimateVsize({
      vaultInputs: 0,
      p2wpkhInputs: 1 + funderInputs.length,
      outputScriptBytes: [
        P2P_OP_RETURN_SCRIPT_BYTES,
        ...tokenOutputs.map((o) => o.script.length),
        ...btcOutputs.map((o) => o.script.length),
        asBuffer(fill.buyerChangeScript).length,
      ],
    });
    let minerFeeSats: bigint;
    try {
      minerFeeSats = resolveMinerFee({
        rateSatPerVb:
          feeInput.feeRateSatPerVb ??
          (feeInput.minerFeeSats === undefined ? standard.satPerVb : undefined),
        explicitSats: feeInput.minerFeeSats,
        vsize,
        floorSatPerVb: rates.floorSatPerVb,
        ceilingSatPerVb: rates.ceilingSatPerVb,
        maxMinerFeeSats: this.config.maxMinerFeeSats,
      }).minerFeeSats;
    } catch (e) {
      if (e instanceof FeeError) throw new MarketError("BUYER_FUNDS_INSUFFICIENT", e.message);
      throw e;
    }

    const result = buildTransferPsbtV2({
      network: btcNetwork(this.config.network),
      tokenId: Buffer.from(listing.tokenId, "hex"),
      tokenInputs: [{ txid: listing.sourceTxid, vout: listing.sourceVout, script: source.scriptPubKey, valueSats: source.valueSats }],
      tokenInputTotalAtoms: listing.sourceAmountAtoms,
      tokenOutputs,
      funderInputs,
      funderChangeScript: asBuffer(fill.buyerChangeScript),
      btcOutputs,
      minerFeeSats,
    });

    const requiredFunding = listing.totalPriceSats + marketFee + extraCarrierSats + minerFeeSats;
    const totalFund = funderInputs.reduce((s, f) => s + f.valueSats, 0n);
    const change = totalFund - requiredFunding;
    if (change < 0n) throw new MarketError("BUYER_FUNDS_INSUFFICIENT", `short ${-change} sats`);

    // Buyer change in (0, dust) cannot be an output, so the builder folds it
    // into the miner fee. Record the fee that the transaction ACTUALLY pays:
    // finalize re-derives it from inputs minus outputs and rejects a mismatch,
    // and the buyer's browser does the same before signing. This used to refuse
    // the fill outright over a few hundred satoshis of unspendable change.
    const settledMinerFeeSats = result.minerFeeSats;

    const psbtB64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    await this.db
      .update(schema.coveV3MarketFills)
      .set({ psbtBase64: psbtB64, unsignedTxDigest: digest, minerFeeSats: settledMinerFeeSats, extraCarrierSats, marketFeeSats: marketFee, status: "PSBT_BUILT", updatedAt: new Date() })
      .where(eq(schema.coveV3MarketFills.id, fillId));
    return psbtB64;
  }

  async submitBuyerSignedPsbt(fillId: string, psbtB64: string): Promise<void> {
    const fill = await this.loadFill(fillId);
    if (!fill) throw new MarketError("STATE_CHANGED", "fill not found");
    if (fill.status !== "PSBT_BUILT") throw new MarketError("STATE_CHANGED", `fill is ${fill.status}`);

    const psbt = parsePsbt(psbtB64, btcNetwork(this.config.network));
    if (fill.unsignedTxDigest && unsignedTxDigest(psbt) !== fill.unsignedTxDigest) {
      throw new MarketError("PSBT_MUTATED", "unsigned tx digest mismatch");
    }

    const fundCount = fillFundInputs(fill).length;
    if (partialSigOfInput(psbt, 0) !== null) {
      throw new MarketError("PSBT_MUTATED", "token input must not be buyer-signed");
    }
    for (let i = 1; i <= fundCount; i++) validateP2wpkhPartialSig(psbt, i);

    await this.db
      .update(schema.coveV3MarketFills)
      .set({ psbtBase64: psbtB64, status: "BUYER_SIGNED", updatedAt: new Date() })
      .where(eq(schema.coveV3MarketFills.id, fillId));
  }

  async submitSellerSignedPsbt(fillId: string, psbtB64: string): Promise<void> {
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });
    const fill = await this.loadFill(fillId);
    if (!fill) throw new MarketError("STATE_CHANGED", "fill not found");
    if (fill.status !== "BUYER_SIGNED") throw new MarketError("STATE_CHANGED", `fill is ${fill.status}`);
    const listing = await this.loadListing(fill.listingId);
    if (!listing) throw new MarketError("STATE_CHANGED", "listing not found");
    await this.resolveSource(listingToV1(listing));

    const psbt = parsePsbt(psbtB64, btcNetwork(this.config.network));
    if (fill.unsignedTxDigest && unsignedTxDigest(psbt) !== fill.unsignedTxDigest) {
      throw new MarketError("PSBT_MUTATED", "unsigned tx digest mismatch");
    }

    validateP2wpkhPartialSig(psbt, 0);
    const fundCount = fillFundInputs(fill).length;
    for (let i = 1; i <= fundCount; i++) {
      if (partialSigOfInput(psbt, i) === null) throw new MarketError("BUYER_SIGNATURE_INVALID", `buyer input ${i} signature lost`);
    }

    await this.db
      .update(schema.coveV3MarketFills)
      .set({ psbtBase64: psbtB64, status: "SELLER_SIGNED", updatedAt: new Date() })
      .where(eq(schema.coveV3MarketFills.id, fillId));
  }

  async finalizeP2PFill(fillId: string): Promise<ValidatedP2PFill> {
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });
    const fill = await this.loadFill(fillId);
    if (!fill) throw new MarketError("STATE_CHANGED", "fill not found");
    if (fill.status !== "SELLER_SIGNED" && fill.status !== "BROADCAST") throw new MarketError("STATE_CHANGED", `fill is ${fill.status}`);
    if (!fill.psbtBase64) throw new MarketError("STATE_CHANGED", "fill has no PSBT");
    const listing = await this.loadListing(fill.listingId);
    if (!listing) throw new MarketError("STATE_CHANGED", "listing not found");
    // Re-check the canary cap at fill time (§P0-6), not just at listing creation.
    assertSettlementCap(listing.totalPriceSats, this.config.maxP2pSettlementSats);

    const psbt = parsePsbt(fill.psbtBase64, btcNetwork(this.config.network));
    psbt.finalizeAllInputs();
    const rawTxHex = psbt.extractTransaction().toHex();

    const terms = this.buildTerms(listing, fill);
    const view = await this.loadView(listing.tokenId, listing.sourceTxid, listing.sourceVout);
    const validated = validateFinalizedP2PFill({ rawTxHex, terms, view, network: this.config.network });

    await this.db
      .update(schema.coveV3MarketFills)
      .set({ txid: validated.txid, updatedAt: new Date() })
      .where(eq(schema.coveV3MarketFills.id, fillId));
    return validated;
  }

  async broadcastP2PFill(validated: ValidatedP2PFill): Promise<{ txid: string }> {
    const res = await broadcastValidatedP2PFill({ validated, network: this.config.network, provider: this.provider });
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.coveV3MarketFills)
        .set({ status: "BROADCAST", txid: res.txid, updatedAt: new Date() })
        .where(eq(schema.coveV3MarketFills.id, validated.fillId));
      await tx
        .update(schema.coveV3MarketListings)
        .set({ status: "BROADCAST", updatedAt: new Date() })
        .where(eq(schema.coveV3MarketListings.listingId, validated.listingId));
      await tx.insert(schema.coveV3MarketEvents).values({
        network: this.config.network,
        listingId: validated.listingId,
        fillId: validated.fillId,
        eventType: "FILL_BROADCAST",
        payloadJson: { txid: res.txid },
      });
    });
    return res;
  }

  /**
   * Idempotent reconciliation: expiry, external/mempool source-spend
   * invalidation, indexer-confirmed fill promotion, and reorg handling.
   */
  async reconcileMarket(): Promise<{ expired: number; invalidated: number; confirmed: number; reorged: number }> {
    const tip = BigInt(await this.provider.getBestHeight());
    const now = new Date();
    let expired = 0;
    let invalidated = 0;
    let confirmed = 0;
    let reorged = 0;

    // (A) Promote BROADCAST fills that the indexer has confirmed.
    const broadcastFills = await this.db
      .select()
      .from(schema.coveV3MarketFills)
      .where(and(eq(schema.coveV3MarketFills.network, this.config.network), eq(schema.coveV3MarketFills.status, "BROADCAST")));
    for (const fill of broadcastFills) {
      const listing = await this.loadListing(fill.listingId);
      if (!listing) continue;
      const utxo = await this.sourceUtxoRow(listing.sourceTxid, listing.sourceVout);
      if (utxo && utxo.spentByTxid === fill.txid && utxo.canonical) {
        await this.db.transaction(async (tx) => {
          await tx.update(schema.coveV3MarketFills).set({ status: "CONFIRMED", blockHeight: utxo.spentHeight ?? tip, blockHash: utxo.spentBlockHash, updatedAt: new Date() }).where(eq(schema.coveV3MarketFills.id, fill.id));
          await tx.update(schema.coveV3MarketListings).set({ status: "FILLED", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
          await this.ensureTrade(tx, fill, listing, utxo.spentHeight ?? tip, utxo.spentBlockHash);
          await tx.insert(schema.coveV3MarketEvents).values({ network: this.config.network, listingId: listing.listingId, fillId: fill.id, eventType: "FILL_CONFIRMED", payloadJson: { txid: fill.txid } });
        });
        confirmed++;
      }
    }

    // (B) Reorg: CONFIRMED fills whose source is no longer spent by their tx.
    const confirmedFills = await this.db
      .select()
      .from(schema.coveV3MarketFills)
      .where(and(eq(schema.coveV3MarketFills.network, this.config.network), eq(schema.coveV3MarketFills.status, "CONFIRMED")));
    for (const fill of confirmedFills) {
      const listing = await this.loadListing(fill.listingId);
      if (!listing) continue;
      const utxo = await this.sourceUtxoRow(listing.sourceTxid, listing.sourceVout);
      if (utxo && utxo.spentByTxid === fill.txid && utxo.canonical) continue; // still confirmed
      await this.db.transaction(async (tx) => {
        await tx.update(schema.coveV3MarketTrades).set({ canonical: false }).where(and(eq(schema.coveV3MarketTrades.network, this.config.network), eq(schema.coveV3MarketTrades.txid, fill.txid!)));
        await tx.update(schema.coveV3MarketFills).set({ status: "REORGED", canonical: false, updatedAt: new Date() }).where(eq(schema.coveV3MarketFills.id, fill.id));
        await tx.update(schema.coveV3MarketListings).set({ status: "REORGED", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
        await tx.insert(schema.coveV3MarketEvents).values({ network: this.config.network, listingId: listing.listingId, fillId: fill.id, eventType: "FILL_REORGED", payloadJson: { txid: fill.txid } });
      });
      reorged++;
    }

    // (C) Reconcile open listings (ACTIVE/RESERVED/BROADCAST) and reorged
    // listings (REORGED): detect external spends and restore post-reorg state.
    const openListings = await this.db
      .select()
      .from(schema.coveV3MarketListings)
      .where(
        and(
          eq(schema.coveV3MarketListings.network, this.config.network),
          inArray(schema.coveV3MarketListings.status, ["ACTIVE", "RESERVED", "BROADCAST", "REORGED"]),
        ),
      );
    for (const listing of openListings) {
      const utxo = await this.sourceUtxoRow(listing.sourceTxid, listing.sourceVout);
      if (utxo && utxo.spentByTxid) {
        // Indexer says the source is confirmed-spent by some tx.
        const ourTx = await this.listingFillTxid(listing.listingId, utxo.spentByTxid);
        if (!ourTx) {
          await this.invalidateListing(listing.listingId, `spent by ${utxo.spentByTxid}`);
          invalidated++;
        }
        continue;
      }
      // No confirmed spend in the indexer view.
      const txout = await this.provider.getTxout(listing.sourceTxid, listing.sourceVout);
      if (txout) {
        // Source is unspent. A reorged listing whose fill tx is gone → ACTIVE.
        if (listing.status === "REORGED") {
          await this.db.update(schema.coveV3MarketListings).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
        }
        continue;
      }
      // Source is spent in the mempool (unconfirmed). Determine the spender.
      const ourTxid = await this.latestFillTxid(listing.listingId);
      const isOurs = ourTxid !== null && (await this.inMempool(ourTxid));
      if (isOurs) {
        if (listing.status === "REORGED") {
          // Our fill is back in the mempool after a reorg: re-pend it.
          await this.db.transaction(async (tx) => {
            await tx
              .update(schema.coveV3MarketFills)
              .set({ status: "BROADCAST", canonical: true, updatedAt: new Date() })
              .where(and(eq(schema.coveV3MarketFills.listingId, listing.listingId), eq(schema.coveV3MarketFills.txid, ourTxid)));
            await tx.update(schema.coveV3MarketListings).set({ status: "BROADCAST", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
            await tx.insert(schema.coveV3MarketEvents).values({ network: this.config.network, listingId: listing.listingId, eventType: "FILL_REPENDING", payloadJson: { txid: ourTxid } });
          });
        }
        continue;
      }
      await this.invalidateListing(listing.listingId, "source spent in mempool by an external tx");
      invalidated++;
    }

    // (D) Expire listings + reservations.
    const expListings = await this.db
      .select()
      .from(schema.coveV3MarketListings)
      .where(and(eq(schema.coveV3MarketListings.network, this.config.network), eq(schema.coveV3MarketListings.status, "ACTIVE"), lte(schema.coveV3MarketListings.expiryHeight, tip)));
    for (const listing of expListings) {
      await this.db.update(schema.coveV3MarketListings).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
      expired++;
    }
    const expFills = await this.db
      .select()
      .from(schema.coveV3MarketFills)
      .where(
        and(
          eq(schema.coveV3MarketFills.network, this.config.network),
          // §M4: reclaim stuck fills at ANY non-terminal stage — a BUYER_SIGNED
          // fill that never finalizes must not lock the listing forever.
          inArray(schema.coveV3MarketFills.status, ["RESERVED", "PSBT_BUILT", "BUYER_SIGNED", "SELLER_SIGNED"]),
          lte(schema.coveV3MarketFills.reservationExpiresAt, now),
        ),
      );
    for (const fill of expFills) {
      await this.db.transaction(async (tx) => {
        await tx.update(schema.coveV3MarketFills).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(schema.coveV3MarketFills.id, fill.id));
        // Release the listing back to ACTIVE if it is still RESERVED for this fill.
        await tx
          .update(schema.coveV3MarketListings)
          .set({ status: "ACTIVE", updatedAt: new Date() })
          .where(and(eq(schema.coveV3MarketListings.listingId, fill.listingId), eq(schema.coveV3MarketListings.status, "RESERVED")));
      });
      expired++;
    }

    return { expired, invalidated, confirmed, reorged };
  }

  // ── reconcile helpers ─────────────────────────────────────────────────────

  private async sourceUtxoRow(txid: string, vout: number) {
    const rows = await this.db
      .select()
      .from(schema.coveV3TokenUtxos)
      .where(and(eq(schema.coveV3TokenUtxos.network, this.config.network), eq(schema.coveV3TokenUtxos.txid, txid), eq(schema.coveV3TokenUtxos.vout, vout)));
    return rows[0] ?? null;
  }

  private async listingFillTxid(listingId: string, spentByTxid: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(schema.coveV3MarketFills)
      .where(and(eq(schema.coveV3MarketFills.listingId, listingId), eq(schema.coveV3MarketFills.txid, spentByTxid)));
    return rows.length > 0;
  }

  private async latestFillTxid(listingId: string): Promise<string | null> {
    const rows = await this.db
      .select({ txid: schema.coveV3MarketFills.txid })
      .from(schema.coveV3MarketFills)
      .where(eq(schema.coveV3MarketFills.listingId, listingId))
      .orderBy(desc(schema.coveV3MarketFills.createdAt))
      .limit(1);
    return rows[0]?.txid ?? null;
  }

  private async inMempool(txid: string): Promise<boolean> {
    try {
      await this.provider.getRawTransaction(txid);
      return true;
    } catch {
      return false;
    }
  }

  private async invalidateListing(listingId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(schema.coveV3MarketListings).set({ status: "INVALIDATED", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listingId));
      await tx
        .update(schema.coveV3MarketFills)
        .set({ status: "FAILED", failureReason: reason, updatedAt: new Date() })
        .where(
          and(
            eq(schema.coveV3MarketFills.listingId, listingId),
            inArray(schema.coveV3MarketFills.status, ["RESERVED", "PSBT_BUILT", "BUYER_SIGNED", "SELLER_SIGNED", "BROADCAST"]),
          ),
        );
      await tx.insert(schema.coveV3MarketEvents).values({ network: this.config.network, listingId, eventType: "LISTING_INVALIDATED", payloadJson: { reason } });
    });
  }

  private async ensureTrade(tx: DbTransaction, fill: FillSelect, listing: ListingSelect, blockHeight: bigint, blockHash: string | null): Promise<void> {
    const existing = await tx
      .select()
      .from(schema.coveV3MarketTrades)
      .where(and(eq(schema.coveV3MarketTrades.network, this.config.network), eq(schema.coveV3MarketTrades.txid, fill.txid!)));
    if (existing.length > 0) {
      // Re-confirmation after a reorg: restore canonicity + new height.
      await tx
        .update(schema.coveV3MarketTrades)
        .set({ canonical: true, blockHeight, blockHash, createdAt: new Date() })
        .where(and(eq(schema.coveV3MarketTrades.network, this.config.network), eq(schema.coveV3MarketTrades.txid, fill.txid!)));
      return;
    }
    await tx.insert(schema.coveV3MarketTrades).values({
      network: this.config.network,
      tokenId: listing.tokenId,
      listingId: listing.listingId,
      fillId: fill.id,
      sellerTokenScript: listing.sellerTokenScript,
      buyerTokenScript: fill.buyerTokenScript,
      amountAtoms: fill.amountAtoms,
      totalPriceSats: fill.totalPriceSats,
      marketFeeSats: fill.marketFeeSats,
      minerFeeSats: fill.minerFeeSats,
      txid: fill.txid!,
      blockHeight,
      blockHash,
      canonical: true,
    });
  }

  // ── build terms / view helpers ────────────────────────────────────────────

  private buildTerms(listing: ListingSelect, fill: FillSelect): P2PFillTerms {
    return {
      listingId: listing.listingId,
      fillId: fill.id,
      tokenId: listing.tokenId,
      sourceTxid: listing.sourceTxid,
      sourceVout: listing.sourceVout,
      sourceAmountAtoms: listing.sourceAmountAtoms,
      sellerTokenScript: asBuffer(listing.sellerTokenScript),
      sellerTokenChangeScript: asBuffer(listing.sellerTokenChangeScript),
      sellerPayoutScript: asBuffer(listing.sellerPayoutScript),
      amountAtoms: listing.amountAtoms,
      totalPriceSats: listing.totalPriceSats,
      marketFeeSats: fill.marketFeeSats,
      minerFeeSats: fill.minerFeeSats,
      buyerTokenScript: asBuffer(fill.buyerTokenScript),
      buyerChangeScript: asBuffer(fill.buyerChangeScript),
      feeScript: this.config.feeScript,
      buyerFundInputs: fillFundInputs(fill).map((f) => ({ txid: f.txid, vout: f.vout, script: asBuffer(f.script), valueSats: f.valueSats })),
    };
  }

  private async loadView(tokenId: string, sourceTxid: string, sourceVout: number): Promise<CoveCanonicalView> {
    return loadCanonicalViewSnapshotFromDb({
      db: this.db,
      network: this.config.network,
      tokenId,
      relevantOutpoints: [{ txid: sourceTxid, vout: sourceVout }],
    });
  }
}
