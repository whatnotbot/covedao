import type { BasisPoints, Sats } from "@crclaunch/curve";

/**
 * Cove fee configuration — the ONE canonical place for protocol fees.
 * Backing principal is NEVER a fee; fees are charged in addition (buy) or
 * deducted from the gross payout (redeem), and never reduce the backing below
 * its required state.
 *
 * These are conservative DEVELOPMENT defaults. The mainnet fee policy is
 * explicit configuration that must be frozen before any mainnet deployment.
 */
export interface CoveFeeConfig {
  /** Backing buy (primary issuance) fee, in basis points. */
  buyFeeBps: BasisPoints;
  /** Backing redemption (instant sell) fee, in basis points. */
  redeemFeeBps: BasisPoints;
  /** Peer-to-peer marketplace fee, in basis points. */
  p2pFeeBps: BasisPoints;
}

export const COVE_FEE_CONFIG: CoveFeeConfig = {
  buyFeeBps: 100n, // 1.00%
  redeemFeeBps: 100n, // 1.00%
  p2pFeeBps: 50n, // 0.50%
};

const BPS_DENOM = 10_000n;

/**
 * Deterministic integer fee: rounds UP to the nearest sat (the protocol never
 * under-charges). Integer-only; no floating point.
 */
export function deterministicFee(grossSats: Sats, feeBps: BasisPoints): Sats {
  if (grossSats < 0n) throw new Error("grossSats must be non-negative");
  if (feeBps < 0n) throw new Error("feeBps must be non-negative");
  if (grossSats === 0n || feeBps === 0n) return 0n;
  return (grossSats * feeBps + BPS_DENOM - 1n) / BPS_DENOM;
}
