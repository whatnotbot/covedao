import type { Sats } from "./types.js";

/** Integer ceiling division for non-negative operands. */
export function ceilDiv(numerator: Sats, denominator: Sats): Sats {
  if (denominator === 0n) throw new Error("Division by zero.");
  if (numerator < 0n || denominator < 0n) throw new Error("ceilDiv requires non-negative inputs.");
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Platform fee rounds UP from the curve contribution.
 * curveContribution is NOT reduced by the fee — the fee is charged in addition.
 */
export function computePlatformFee(
  curveContributionSats: Sats,
  feeBps: bigint,
): Sats {
  if (feeBps < 0n) throw new Error("feeBps must be non-negative.");
  if (curveContributionSats < 0n) throw new Error("curveContributionSats must be non-negative.");
  if (curveContributionSats === 0n || feeBps === 0n) return 0n;
  return ceilDiv(curveContributionSats * feeBps, 10_000n);
}

/**
 * Dynamically increased minimum contribution: at least 1,000 sats, or
 * estimatedMinerFee × 5 when fees are high. Goal: miner fee normally ≤ 20%
 * of primary purchase amount.
 */
export function getMinimumContribution(estimatedMinerFeeSats: Sats): Sats {
  const floor = 1_000n;
  const dynamic = estimatedMinerFeeSats * 5n;
  return dynamic > floor ? dynamic : floor;
}
