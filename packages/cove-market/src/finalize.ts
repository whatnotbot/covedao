import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import { TOKEN_CARRIER_SATS, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import {
  validateFinalizedTransferTransaction,
  broadcastValidatedCoveTransaction,
  type ValidatedCoveTransaction,
  type ResolvedPrevout,
} from "@crclaunch/cove-guardian/v3";
import { parseCoveTx } from "@crclaunch/cove-indexer/v3";
import { OP_TRANSFER } from "@crclaunch/cove-wire";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { dustThreshold } from "@crclaunch/cove-economics";
import { MarketError } from "./errors.js";

/**
 * Market final validation (§14): a P2P fill is a plain Cove TRANSFER plus the
 * market's own semantics (exact seller payout, exact p2p fee, exact miner fee,
 * single source token input, no backing/Guardian involvement, dust-safe
 * payouts). On success it returns an opaque `ValidatedP2PFill` that ONLY this
 * module can construct; `broadcastValidatedP2PFill` accepts nothing else.
 */

const ValidatedP2PFillBrand: unique symbol = Symbol("ValidatedP2PFill");

export interface ValidatedP2PFill {
  readonly [ValidatedP2PFillBrand]: true;
  readonly validatedTransfer: ValidatedCoveTransaction;
  readonly txid: string;
  readonly listingId: string;
  readonly fillId: string;
  readonly tokenId: string;
  readonly validationDigest: string;
}

export interface P2PFillTerms {
  listingId: string;
  fillId: string;
  tokenId: string; // 64-hex
  sourceTxid: string;
  sourceVout: number;
  sourceAmountAtoms: bigint;
  sellerTokenScript: Buffer;
  sellerTokenChangeScript: Buffer;
  sellerPayoutScript: Buffer;
  amountAtoms: bigint;
  totalPriceSats: bigint;
  marketFeeSats: bigint;
  minerFeeSats: bigint;
  buyerTokenScript: Buffer;
  buyerChangeScript: Buffer;
  feeScript: Buffer;
  buyerFundInputs: { txid: string; vout: number; script: Buffer; valueSats: bigint }[];
}

export interface P2PFillValidationParams {
  rawTxHex: string;
  terms: P2PFillTerms;
  view: CoveCanonicalView;
  network: "regtest" | "signet" | "testnet";
}

function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

function inputTxid(ins: bitcoin.TxInput): string {
  return Buffer.from(ins.hash).reverse().toString("hex");
}

function reject(code: string, detail: string): never {
  throw new MarketError("MARKET_VALIDATION_FAILED", `${code}: ${detail}`);
}

/**
 * Pure market semantics on top of `validateFinalizedTransferTransaction`.
 * Throws a `MarketError` on any market-rule violation; returns the opaque
 * `ValidatedP2PFill` otherwise.
 */
export function validateFinalizedP2PFill(params: P2PFillValidationParams): ValidatedP2PFill {
  const { terms } = params;

  // Build resolved prevouts for every input so the transfer validator enforces
  // the exact miner fee (it skips that check when prevouts are absent).
  const prevouts = new Map<string, ResolvedPrevout>();
  prevouts.set(outpointKey(terms.sourceTxid, terms.sourceVout), {
    script: terms.sellerTokenScript,
    valueSats: TOKEN_CARRIER_SATS,
  });
  for (const f of terms.buyerFundInputs) {
    prevouts.set(outpointKey(f.txid, f.vout), { script: f.script, valueSats: f.valueSats });
  }

  const base = validateFinalizedTransferTransaction({
    rawTxHex: params.rawTxHex,
    view: params.view,
    prevouts,
    maxMinerFeeSats: terms.minerFeeSats,
  });
  if (!("rawTxHex" in base)) reject("TRANSFER_VALIDATION", base.reason);

  const tx = bitcoin.Transaction.fromHex(params.rawTxHex);
  const wire = parseCoveTx(params.rawTxHex);
  if (wire.kind !== "TRANSFER") reject("NOT_TRANSFER", `kind=${wire.kind}`);
  const envelope = wire.envelope;
  if (envelope.op !== OP_TRANSFER) reject("NOT_TRANSFER", `op=${envelope.op}`);
  const allocations = envelope.allocations;

  // (a) input 0 is the listing's exact source outpoint.
  const ins0 = tx.ins[0];
  if (!ins0 || inputTxid(ins0) !== terms.sourceTxid || ins0.index !== terms.sourceVout) {
    reject("SOURCE_INPUT", "input 0 is not the listing source outpoint");
  }

  // (b) NO backing/Guardian/supply involvement: no input may spend the backing.
  const tokenIdBuf = Buffer.from(terms.tokenId, "hex");
  const backingOutpoint = params.view.getBackingOutpoint(tokenIdBuf);
  for (const ins of tx.ins) {
    if (backingOutpoint && inputTxid(ins) === backingOutpoint.txid && ins.index === backingOutpoint.vout) {
      reject("BACKING_TOUCHED", "P2P fill must never spend the backing UTXO");
    }
  }

  // (c) token allocations: buyer amount + optional seller change.
  const changeAtoms = terms.sourceAmountAtoms - terms.amountAtoms;
  const expectedAllocs = changeAtoms > 0n ? 2 : 1;
  if (allocations.length !== expectedAllocs) reject("ALLOCATION_COUNT", `${allocations.length} != ${expectedAllocs}`);
  const buyerAlloc = allocations[0]!;
  if (buyerAlloc.vout !== 1 || buyerAlloc.amount !== terms.amountAtoms) {
    reject("BUYER_ALLOCATION", `vout=${buyerAlloc.vout} amount=${buyerAlloc.amount}`);
  }
  if (changeAtoms > 0n) {
    const changeAlloc = allocations[1]!;
    if (changeAlloc.vout !== 2 || changeAlloc.amount !== changeAtoms) {
      reject("SELLER_CHANGE_ALLOCATION", `vout=${changeAlloc.vout} amount=${changeAlloc.amount}`);
    }
  }

  // (d) token carrier output scripts.
  const buyerCarrier = tx.outs[1];
  if (!buyerCarrier || !buyerCarrier.script.equals(terms.buyerTokenScript)) {
    reject("BUYER_CARRIER_SCRIPT", "vout 1 is not the buyer token carrier");
  }
  if (changeAtoms > 0n) {
    const changeCarrier = tx.outs[2];
    if (!changeCarrier || !changeCarrier.script.equals(terms.sellerTokenChangeScript)) {
      reject("SELLER_CHANGE_CARRIER_SCRIPT", "vout 2 is not the seller change carrier");
    }
  }

  // (e) BTC outputs: seller payout, then p2p fee, then optional buyer change.
  const sellerPayoutVout = 1 + expectedAllocs;
  const feeVout = sellerPayoutVout + 1;
  const payout = tx.outs[sellerPayoutVout];
  if (!payout || !payout.script.equals(terms.sellerPayoutScript) || BigInt(payout.value) !== terms.totalPriceSats) {
    reject("SELLER_PAYOUT", "seller payout output mismatch");
  }
  const feeOut = tx.outs[feeVout];
  if (!feeOut || !feeOut.script.equals(terms.feeScript) || BigInt(feeOut.value) !== terms.marketFeeSats) {
    reject("P2P_FEE", "p2p fee output mismatch");
  }
  if (tx.outs.length > feeVout + 1) {
    const buyerChange = tx.outs[feeVout + 1];
    if (!buyerChange || !buyerChange.script.equals(terms.buyerChangeScript)) {
      reject("BUYER_CHANGE", "unexpected buyer change output");
    }
  }
  if (tx.outs.length > feeVout + 2) reject("UNEXPECTED_OUTPUT", "too many outputs");

  // (f) dust safety: seller payout and p2p fee must clear relay dust.
  if (terms.totalPriceSats < dustThreshold(terms.sellerPayoutScript)) {
    reject("SELLER_PAYOUT_DUST", `payout ${terms.totalPriceSats} < dust`);
  }
  if (terms.marketFeeSats < dustThreshold(terms.feeScript)) {
    reject("MARKET_FEE_DUST", `fee ${terms.marketFeeSats} < dust`);
  }

  // (g) exact miner fee.
  const totalIn = [...prevouts.values()].reduce((s, p) => s + p.valueSats, 0n);
  const totalOut = tx.outs.reduce((s, o) => s + BigInt(o.value), 0n);
  const minerFee = totalIn - totalOut;
  if (minerFee !== terms.minerFeeSats) reject("MINER_FEE", `${minerFee} != ${terms.minerFeeSats}`);

  const digest = createHash("sha256").update(params.rawTxHex, "hex").digest("hex");
  return {
    [ValidatedP2PFillBrand]: true,
    validatedTransfer: base,
    txid: base.txid,
    listingId: terms.listingId,
    fillId: terms.fillId,
    tokenId: terms.tokenId,
    validationDigest: digest,
  };
}

/** Hardened broadcast boundary: accepts ONLY an opaque ValidatedP2PFill. */
export async function broadcastValidatedP2PFill(params: {
  validated: ValidatedP2PFill;
  network: "regtest" | "signet" | "testnet";
  provider: CoreRpcProvider;
}): Promise<{ txid: string }> {
  const res = await broadcastValidatedCoveTransaction({
    validated: params.validated.validatedTransfer,
    network: params.network,
    provider: params.provider,
  });
  return { txid: res.txid };
}

export function isP2PFillValidated(x: unknown): x is ValidatedP2PFill {
  return typeof x === "object" && x !== null && ValidatedP2PFillBrand in x;
}
