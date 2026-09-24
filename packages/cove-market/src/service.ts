import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { eq, and, isNull, inArray, lte } from "drizzle-orm";
import { schema, type Database, type DbTransaction } from "@crclaunch/db";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { TOKEN_CARRIER_SATS, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import { buildTransferPsbtV2, type ResolvedInput } from "@crclaunch/cove-guardian/v3";
import { loadCanonicalViewSnapshotFromDb } from "@crclaunch/cove-indexer/v3";
import { COVE_FEE_CONFIG, deterministicFee, dustThreshold } from "@crclaunch/cove-economics";
import { MarketError } from "./errors.js";
import type { MarketConfig } from "./config.js";
import type { ListingV1, CancellationV1 } from "./types.js";
import { listingIdOf, cancellationHashOf } from "./order/hash.js";
import { verifyListingAuthorization, verifyCancellationAuthorization } from "./order/signature.js";
import { validateListingShape } from "./order/validate.js";
import { unsignedTxDigest, parsePsbt, validateP2wpkhPartialSig, partialSigOfInput } from "./psbt.js";
import {
  validateFinalizedP2PFill,
  broadcastValidatedP2PFill,
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
}

type ListingSelect = typeof schema.coveV3MarketListings.$inferSelect;
type FillSelect = typeof schema.coveV3MarketFills.$inferSelect;

interface SourceResolution {
  scriptPubKey: Buffer;
  amountAtoms: bigint;
  valueSats: bigint;
}

function btcNetwork(network: MarketConfig["network"]): bitcoin.networks.Network {
  return network === "regtest" ? bitcoin.networks.regtest : bitcoin.networks.testnet;
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
    await assertMarketReady({ db: this.db, config: this.config, provider: this.provider });
    validateListingShape(input);

    if (!verifyListingAuthorization(input, input.signatureB64)) {
      throw new MarketError("LISTING_BAD_SIGNATURE", "listing BIP-322 signature invalid");
    }
    await this.resolveSource(input);

    if (input.totalPriceSats < dustThreshold(asBuffer(input.sellerPayoutScript))) {
      throw new MarketError("SELLER_PAYOUT_DUST", "seller payout below relay dust");
    }
    const marketFee = deterministicFee(input.totalPriceSats, COVE_FEE_CONFIG.p2pFeeBps);
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

      const marketFee = deterministicFee(row.totalPriceSats, COVE_FEE_CONFIG.p2pFeeBps);
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

  async buildFillPsbt(fillId: string, minerFeeSats: bigint): Promise<string> {
    if (minerFeeSats > this.config.maxMinerFeeSats) throw new MarketError("BUYER_FUNDS_INSUFFICIENT", "miner fee exceeds cap");
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
    const marketFee = deterministicFee(listing.totalPriceSats, COVE_FEE_CONFIG.p2pFeeBps);
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

    // Exact fee: buyer change must be 0 or >= relay dust; (0, 294) would leak
    // into the miner fee and break the exact-fee check at finalize.
    const requiredFunding = listing.totalPriceSats + marketFee + extraCarrierSats + minerFeeSats;
    const totalFund = funderInputs.reduce((s, f) => s + f.valueSats, 0n);
    const change = totalFund - requiredFunding;
    if (change < 0n) throw new MarketError("BUYER_FUNDS_INSUFFICIENT", `short ${-change} sats`);
    if (change > 0n && change < 294n) throw new MarketError("BUYER_FUNDS_INSUFFICIENT", `buyer change ${change} sats is below relay dust`);

    const psbtB64 = result.psbt.toBase64();
    const digest = unsignedTxDigest(result.psbt);
    await this.db
      .update(schema.coveV3MarketFills)
      .set({ psbtBase64: psbtB64, unsignedTxDigest: digest, minerFeeSats, extraCarrierSats, marketFeeSats: marketFee, status: "PSBT_BUILT", updatedAt: new Date() })
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

    // (C) Invalidate listings whose source was spent by someone else.
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
        // Spent per the indexer. If it is NOT one of our own fills → external.
        const ourTx = await this.listingFillTxid(listing.listingId, utxo.spentByTxid);
        if (!ourTx) {
          await this.invalidateListing(listing.listingId, `spent by ${utxo.spentByTxid}`);
          invalidated++;
        }
        continue;
      }
      // Indexer has no spend yet — confirm Core agrees the source is unspent.
      const txout = await this.provider.getTxout(listing.sourceTxid, listing.sourceVout);
      if (!txout) {
        // Spent in mempool. If it is our BROADCAST fill still in mempool, skip.
        const fill = await this.listingOpenFill(listing.listingId);
        const isOurs = fill?.status === "BROADCAST" && fill.txid && (await this.inMempool(fill.txid));
        if (!isOurs) {
          await this.invalidateListing(listing.listingId, "source spent in mempool by an external tx");
          invalidated++;
        }
      } else if (listing.status === "REORGED") {
        // Source is spendable again after reorg: return to ACTIVE (unless cancelled).
        await this.db.update(schema.coveV3MarketListings).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(schema.coveV3MarketListings.listingId, listing.listingId));
      }
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
          eq(schema.coveV3MarketFills.status, "RESERVED"),
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

  private async listingOpenFill(listingId: string): Promise<FillSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.coveV3MarketFills)
      .where(
        and(
          eq(schema.coveV3MarketFills.listingId, listingId),
          inArray(schema.coveV3MarketFills.status, ["RESERVED", "PSBT_BUILT", "BUYER_SIGNED", "SELLER_SIGNED", "BROADCAST", "CONFIRMED"]),
        ),
      );
    return rows[0] ?? null;
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
    if (existing.length > 0) return;
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
