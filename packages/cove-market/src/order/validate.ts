import { isP2TR, isP2WPKH } from "@crclaunch/cove-economics";
import { isP2SH } from "@crclaunch/bitcoin";
import { MARKET_ORDER_VERSION, type ListingV1 } from "../types.js";
import { MarketError } from "../errors.js";

/**
 * Pure listing validation (§10, the parts that do not need DB/Core). The
 * DB/Core-dependent checks (source UTXO resolution, gettxout, health) are in the
 * service layer.
 */

/**
 * A script that may hold a TOKEN CARRIER.
 *
 * This is a protocol rule, not a policy one: the indexer only recognises a
 * carrier on native segwit or Taproot, so a carrier anywhere else would be
 * tokens nobody can see.
 */
function standardCarrierScript(scriptHex: string): boolean {
  if (!/^[0-9a-f]*$/i.test(scriptHex)) return false;
  const script = Buffer.from(scriptHex, "hex");
  return isP2WPKH(script) || isP2TR(script);
}

/**
 * A script that may receive PLAIN BITCOIN.
 *
 * Wider than a carrier on purpose. A seller's payout is an ordinary payment,
 * and Xverse and Magic Eden hand out nested-segwit payment addresses —
 * restricting this to carrier scripts meant those wallets could hold a token
 * and then never be paid for selling it.
 */
function standardPayoutScript(scriptHex: string): boolean {
  if (!/^[0-9a-f]*$/i.test(scriptHex)) return false;
  const script = Buffer.from(scriptHex, "hex");
  return isP2WPKH(script) || isP2TR(script) || isP2SH(script);
}

export function validateListingShape(l: ListingV1): void {
  if (l.orderVersion !== MARKET_ORDER_VERSION) throw new MarketError("LISTING_BAD_VERSION", "orderVersion != 1");
  if (!/^[0-9a-f]{64}$/.test(l.tokenId)) throw new MarketError("LISTING_TOKEN_MISMATCH", "bad tokenId");
  if (!/^[0-9a-f]{64}$/.test(l.sourceTxid)) throw new MarketError("LISTING_BAD_SOURCE", "bad sourceTxid");
  if (!/^[0-9a-f]{64}$/.test(l.nonce)) throw new MarketError("LISTING_BAD_SOURCE", "bad nonce");
  if (!standardCarrierScript(l.sellerTokenScript)) throw new MarketError("LISTING_BAD_SOURCE", "seller token script not standard");
  if (!standardPayoutScript(l.sellerPayoutScript)) throw new MarketError("LISTING_BAD_SOURCE", "seller payout script not standard");
  if (l.sellerTokenChangeScript !== l.sellerTokenScript) {
    throw new MarketError("LISTING_BAD_SOURCE", "V1 requires the change script to equal the token script");
  }
  if (l.sourceVout < 0) throw new MarketError("LISTING_BAD_SOURCE", "bad sourceVout");
  if (l.amountAtoms <= 0n) throw new MarketError("LISTING_AMOUNT_INVALID", "zero amount");
  if (l.amountAtoms > l.sourceAmountAtoms) throw new MarketError("LISTING_AMOUNT_INVALID", "amount > source amount");
  if (l.totalPriceSats <= 0n) throw new MarketError("LISTING_PRICE_INVALID", "zero price");
  if (l.expiryHeight <= l.creationHeight) throw new MarketError("LISTING_EXPIRED", "expiry <= creation");
}
