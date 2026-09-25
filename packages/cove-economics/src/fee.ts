import type { BasisPoints, Sats } from "@crclaunch/curve";

/**
 * Cove fee configuration — the ONE canonical place for protocol fees.
 *
 * Backing principal is NEVER a fee; fees are charged in addition (buy) or
 * deducted from the gross payout (redeem), and never reduce the backing below
 * its required state.
 *
 * Each fee has a FLAT component and a PERCENTAGE component, and the flat part
 * is not cosmetic. A pure-percentage fee on a small trade produces a fee output
 * below Bitcoin's relay dust limit, which is non-standard — so the whole
 * transaction is refused. With a 1% fee that put a hard floor of ~29,300 sats
 * on every buy AND on every redemption, locking small holders out of the exit
 * entirely. A flat component above the dust threshold removes that floor.
 *
 * These are DEVELOPMENT defaults. The mainnet fee policy is explicit
 * configuration that must be frozen before any mainnet deployment.
 */
export interface CoveFeeConfig {
  /** Backing buy (primary issuance) fee, in basis points. */
  buyFeeBps: BasisPoints;
  /** Flat sats added to every backing buy. */
  buyFeeFlatSats: Sats;
  /** Backing redemption (instant sell) fee, in basis points. */
  redeemFeeBps: BasisPoints;
  /** Flat sats deducted from every redemption payout. */
  redeemFeeFlatSats: Sats;
  /** Peer-to-peer marketplace fee, in basis points. */
  p2pFeeBps: BasisPoints;
  /** Flat sats added to every peer-to-peer fill. */
  p2pFeeFlatSats: Sats;
}

export const COVE_FEE_CONFIG: CoveFeeConfig = {
  // 2,500 sats is ~$2.50 at $100k/BTC and comfortably clears the 294-sat
  // P2WPKH dust threshold, so no trade is ever refused for a dust fee.
  buyFeeBps: 750n, // 7.50%
  buyFeeFlatSats: 2_500n,
  // The redemption fee is the price of the exit. A percentage here is charged
  // against a holder who is already taking the curve price, and it is what a
  // "floor" is really worth, so it stays flat-only by default.
  redeemFeeBps: 0n,
  redeemFeeFlatSats: 2_500n,
  p2pFeeBps: 750n, // 7.50%
  p2pFeeFlatSats: 2_500n,
};

const BPS_DENOM = 10_000n;

/**
 * Deterministic integer fee: `flat + ceil(gross × bps / 10000)`.
 *
 * Rounds UP to the nearest sat, so the protocol never under-charges. Integer
 * only; no floating point anywhere.
 *
 * `flatSats` defaults to zero so a caller that has not been taught about the
 * flat component behaves exactly as before rather than silently charging it.
 */
export function deterministicFee(
  grossSats: Sats,
  feeBps: BasisPoints,
  flatSats: Sats = 0n,
): Sats {
  if (grossSats < 0n) throw new Error("grossSats must be non-negative");
  if (feeBps < 0n) throw new Error("feeBps must be non-negative");
  if (flatSats < 0n) throw new Error("flatSats must be non-negative");
  if (grossSats === 0n) return 0n;
  const pct = feeBps === 0n ? 0n : (grossSats * feeBps + BPS_DENOM - 1n) / BPS_DENOM;
  return flatSats + pct;
}
