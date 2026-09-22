import { PUBLIC_SUPPLY_ATOMS } from "./constants.js";
import { quoteExactTokens } from "./quote.js";
import type { Sats, TokenAtoms } from "./types.js";

/**
 * Canonical mint validation rule for the `crc-launch-v1` profile (proposed).
 * Deterministic, integer-only. A mint is valid iff:
 *   - profile is exactly crc-launch-v1
 *   - the ticker exists (caller resolves existence from canonical state)
 *   - requestedAmount > 0
 *   - requestedAmount <= remaining public supply
 *   - paymentSats >= requiredPayment (computed from the canonical price table)
 *   - the operation has not been replayed
 */
export interface CanonicalMintInput {
  profile: string;
  tickerExists: boolean;
  confirmedSupplyTokens: TokenAtoms;
  publicSupplyTokens: TokenAtoms;
  requestedAmountTokens: TokenAtoms;
  paymentSats: Sats;
  replayed: boolean;
  /** Supply the operation was built against; mismatch ⇒ stale-state rejection. */
  claimedSupplyBeforeTokens?: TokenAtoms;
}

export interface CanonicalMintResult {
  valid: boolean;
  requiredPaymentSats: Sats | null;
  reason: string | null;
}

export const CRC_LAUNCH_V1_PROFILE = "crc-launch-v1";

export function validateCanonicalMint(input: CanonicalMintInput): CanonicalMintResult {
  if (input.profile !== CRC_LAUNCH_V1_PROFILE) {
    return { valid: false, requiredPaymentSats: null, reason: "unsupported profile" };
  }
  if (!input.tickerExists) {
    return { valid: false, requiredPaymentSats: null, reason: "ticker not found" };
  }
  if (input.replayed) {
    return { valid: false, requiredPaymentSats: null, reason: "replayed operation" };
  }
  if (input.requestedAmountTokens <= 0n) {
    return { valid: false, requiredPaymentSats: null, reason: "amount must be positive" };
  }
  if (
    input.claimedSupplyBeforeTokens !== undefined &&
    input.claimedSupplyBeforeTokens !== input.confirmedSupplyTokens
  ) {
    return { valid: false, requiredPaymentSats: null, reason: "stale supply" };
  }
  const remaining = PUBLIC_SUPPLY_ATOMS - input.confirmedSupplyTokens;
  if (input.requestedAmountTokens > remaining) {
    return { valid: false, requiredPaymentSats: null, reason: "exceeds remaining public supply" };
  }
  const quote = quoteExactTokens({
    desiredTokens: input.requestedAmountTokens,
    currentSupply: input.confirmedSupplyTokens,
  });
  const requiredPayment = quote.curveContributionSats;
  if (input.paymentSats < requiredPayment) {
    return { valid: false, requiredPaymentSats: requiredPayment, reason: "underpayment" };
  }
  return { valid: true, requiredPaymentSats: requiredPayment, reason: null };
}
