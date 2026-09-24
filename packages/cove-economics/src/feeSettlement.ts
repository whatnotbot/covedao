import type { BasisPoints, Sats } from "@crclaunch/curve";
import { dustThreshold } from "./dust.js";

/**
 * Explicit protocol-fee settlement check (Phase 4.4 §19).
 *
 * A nonzero nominal protocol fee whose output is below Bitcoin Core relay dust
 * would be non-standard and must NEVER be created silently, folded into
 * backing, raised to the dust amount, or waived. This returns the typed
 * PROTOCOL_FEE_DUST condition plus the minimum gross that WOULD produce a
 * standard fee output under the current (still-UNFROZEN, dev) fee model.
 */

const BPS_DENOM = 10_000n;

export interface FeeSettlementCheck {
  nominalFeeSats: Sats;
  feeScript: Uint8Array;
  dustThresholdSats: Sats;
  /** true when nominalFee==0 OR nominalFee >= dustThreshold (standard). */
  isStandard: boolean;
  /**
   * Minimum gross (R-delta) whose protocol fee (ceil(gross·bps/10000)) reaches
   * the dust threshold. null when feeBps==0 (no fee ever charged).
   */
  minimumGrossForStandardFeeOutput: Sats | null;
}

export function checkFeeSettlement(
  nominalFeeSats: Sats,
  feeScript: Uint8Array,
  feeBps: BasisPoints,
): FeeSettlementCheck {
  if (nominalFeeSats < 0n) throw new Error("nominalFeeSats must be non-negative");
  const dust = dustThreshold(feeScript);
  const isStandard = nominalFeeSats === 0n || nominalFeeSats >= dust;
  // smallest gross G with ceil(G·bps/10000) >= dust  ⟺  G·bps > (dust-1)·10000.
  const minimumGross =
    feeBps === 0n ? null : ((dust - 1n) * BPS_DENOM) / feeBps + 1n;
  return {
    nominalFeeSats,
    feeScript,
    dustThresholdSats: dust,
    isStandard,
    minimumGrossForStandardFeeOutput: minimumGross,
  };
}
