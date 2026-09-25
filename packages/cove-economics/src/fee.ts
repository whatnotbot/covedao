import type { BasisPoints, Sats, DisplayTokens } from "@crclaunch/curve";
import { geometric20, PUBLIC_SUPPLY } from "./curve.js";

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
  /**
   * Flat component of the buy fee AT THE TOP STAGE, in sats.
   *
   * The flat part scales with the stage price rather than being constant. The
   * curve moves 299x from the first stage to the last, so a constant flat fee
   * that is reasonable at the top is many times the purchase at the bottom —
   * at stage 1 a 10,000-sat flat fee on a 1,050-sat buy is 960%. Anchoring it
   * to the top stage and scaling it down keeps the effective rate the same at
   * every stage.
   */
  buyFeeFlatSatsAtTopStage: Sats;
  /** Backing redemption (instant sell) fee, in basis points. */
  redeemFeeBps: BasisPoints;
  /** Flat sats deducted from every redemption payout. */
  redeemFeeFlatSats: Sats;
  /** Peer-to-peer marketplace fee, in basis points. */
  p2pFeeBps: BasisPoints;
  /** Flat sats added to every peer-to-peer fill. */
  p2pFeeFlatSats: Sats;
  /**
   * Floor under the peer-to-peer fee.
   *
   * The marketplace fee is a pure percentage, so a small listing would produce
   * a fee output below the relay dust threshold and the fill would be refused
   * outright. A floor keeps every fill standard without charging a flat amount
   * on top of the percentage for ordinary trades.
   */
  p2pFeeMinSats: Sats;
}

export const COVE_FEE_CONFIG: CoveFeeConfig = {
  // Mint: a flat launch-style fee plus a share of the curve price. The flat
  // 10,000 sats comfortably clears the 294-sat P2WPKH dust threshold, so no
  // buy is ever refused for a dust fee.
  buyFeeBps: 750n, // 7.50%
  buyFeeFlatSatsAtTopStage: 10_000n,
  // Redemption is the exit, and the exit is the whole product. A percentage
  // here is charged against a holder already accepting the curve price and
  // directly erodes the floor, so it stays flat-only — and at a quarter of the
  // mint flat, so cashing out a small position remains worth doing.
  redeemFeeBps: 0n,
  redeemFeeFlatSats: 2_500n,
  // Marketplace: a clean percentage, floored so a small fill is never refused
  // for a dust fee.
  p2pFeeBps: 750n, // 7.50%
  p2pFeeFlatSats: 0n,
  p2pFeeMinSats: 1_000n,
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
  minSats: Sats = 0n,
): Sats {
  if (grossSats < 0n) throw new Error("grossSats must be non-negative");
  if (feeBps < 0n) throw new Error("feeBps must be non-negative");
  if (flatSats < 0n) throw new Error("flatSats must be non-negative");
  if (minSats < 0n) throw new Error("minSats must be non-negative");
  if (grossSats === 0n) return 0n;
  const pct = feeBps === 0n ? 0n : (grossSats * feeBps + BPS_DENOM - 1n) / BPS_DENOM;
  const fee = flatSats + pct;
  return fee < minSats ? minSats : fee;
}

/** Stage count of the frozen curve. */
const TOP_STAGE = 20;

/**
 * The flat fee component for a buy starting at `supply`, scaled to the stage.
 *
 * `flat = anchor x stagePrice / topStagePrice`
 *
 * So a buy at the first stage pays the same PROPORTION of its purchase as a buy
 * at the last one, instead of a constant number of sats that is trivial at the
 * top and ruinous at the bottom.
 *
 * Rounds up, so the protocol never under-charges, and never returns zero for a
 * nonzero anchor — a zero flat would silently turn this into a pure percentage.
 */
export function stageScaledFlatSats(supply: DisplayTokens, anchorAtTopStage: Sats): Sats {
  if (anchorAtTopStage <= 0n) return 0n;
  const top = geometric20.priceAt(PUBLIC_SUPPLY);
  const here = geometric20.priceAt(supply);
  const scaled = (anchorAtTopStage * here + top - 1n) / top;
  return scaled < 1n ? 1n : scaled;
}

export { TOP_STAGE };
