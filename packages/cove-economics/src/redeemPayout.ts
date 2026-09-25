import type { Sats } from "@crclaunch/curve";
import { dustThreshold } from "./dust.js";

/**
 * Is a redemption worth making?
 *
 * The exit fee has a FLAT component, so a small enough redemption is worth
 * less than the fee: the payout falls to zero and then goes negative. That
 * cannot be built — a Bitcoin output is never negative, and one below the
 * relay dust threshold will not propagate — so it must be refused where the
 * user asks the price, not deep inside a PSBT builder.
 *
 * At the development schedule (flat 2,500 sats, 0 bps) and a P2WPKH payout,
 * the floor is 2,794 sats: roughly 5.6 million tokens at the first curve
 * stage. Selling less than that is not possible, and saying so plainly beats
 * an arithmetic failure three layers down.
 */
export interface RedeemPayoutCheck {
  grossSats: Sats;
  feeSats: Sats;
  /** gross − fee. Negative when the sale is worth less than the exit fee. */
  netSats: Sats;
  /** Relay dust threshold for the payout script. */
  dustThresholdSats: Sats;
  /** true when the payout is an output Bitcoin will actually carry. */
  isPayable: boolean;
  /** Smallest gross that produces a payable payout: fee + dust. */
  minimumGrossSats: Sats;
}

export function checkRedeemPayout(
  grossSats: Sats,
  feeSats: Sats,
  payoutScript: Uint8Array,
): RedeemPayoutCheck {
  if (grossSats < 0n) throw new Error("grossSats must be non-negative");
  if (feeSats < 0n) throw new Error("feeSats must be non-negative");
  const dust = dustThreshold(payoutScript);
  const netSats = grossSats - feeSats;
  return {
    grossSats,
    feeSats,
    netSats,
    dustThresholdSats: dust,
    isPayable: netSats >= dust,
    minimumGrossSats: feeSats + dust,
  };
}
