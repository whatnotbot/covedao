import type { Sats } from "@crclaunch/curve";

/**
 * Token-carrier output semantics (§5). A Cove token carrier is an ordinary
 * spendable Bitcoin output whose sat value is protocol/product dust funding
 * ONLY — the token amount is carried by Cove V2 allocation metadata + valid
 * input lineage, never inferred from the sat value.
 *
 * Backing principal MUST NEVER fund token carrier outputs or miner fees.
 */

/** Dust funding for a token carrier output (above P2WPKH/P2TR relay dust). */
export const TOKEN_CARRIER_SATS: Sats = 1_000n;

/** Whether a carrier value is acceptable (>= the frozen carrier sats). */
export function isCarrierValue(valueSats: Sats): boolean {
  return valueSats >= TOKEN_CARRIER_SATS;
}
