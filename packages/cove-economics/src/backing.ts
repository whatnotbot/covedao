import type { DisplayTokens, Sats } from "@crclaunch/curve";
import { geometric20, PUBLIC_SUPPLY } from "./curve.js";
import { deterministicFee, COVE_FEE_CONFIG, type CoveFeeConfig } from "./fee.js";

/**
 * Cove Backing reserve function (Layer A of the market model).
 *
 *   R(s) = required BTC backing (in satoshis) for issued public supply `s`.
 *
 * R(s) is the SAME `geometric20` curve integral used for primary buys. Buy and
 * redemption are the forward and reverse movements through this ONE function:
 *
 *   grossBuy    = R(s + q) - R(s)
 *   grossRedeem = R(s) - R(s - q)
 *
 * There is NO separate sell curve. Redemption value is NEVER derived from last
 * trade, market cap, average price, or a discount off the buy price.
 *
 * This is a deterministic issuance/redemption reserve (a bonding/backing
 * reserve), NOT a constant-product AMM: there are no LPs, no LP tokens, no
 * x*y=k, no paired inventory, no swap router. If Cove automatically buys tokens
 * back, it is economically acting as a market maker — that distinction is stated
 * plainly and never hidden behind AMM/DEX terminology.
 */

/** Required BTC backing (sats) for an issued public supply (display tokens). */
export function requiredBackingSats(supply: DisplayTokens): Sats {
  assertSupplyInRange(supply);
  return geometric20.costToBuy(0n, supply);
}

export interface Quote {
  /** Curve/backing gross movement (sats). */
  gross: Sats;
  /** Protocol fee (sats), deterministic integer. */
  fee: Sats;
  /** Net sats (buy: gross+fee paid by buyer; redeem: gross-fee paid to seller). */
  net: Sats;
}

function assertSupplyInRange(supply: DisplayTokens): void {
  if (supply < 0n) throw new Error("supply must be non-negative");
  if (supply > PUBLIC_SUPPLY) throw new Error("supply exceeds public cap");
}

/**
 * Gross curve cost to buy `amount` tokens from `supply`.
 *
 * Defined as the forward R-delta `R(s+q) - R(s)` — NOT a fresh per-chunk walk —
 * so buy and redeem are exact inverses through the SAME canonical reserve
 * function (path-independent, round-trip exact). The Phase 3 fresh-ceil
 * `quoteExactTokens` remains as the legacy primary-mint reference; the backing
 * model uses R-deltas.
 */
export function grossBuy(supply: DisplayTokens, amount: DisplayTokens): Sats {
  assertSupplyInRange(supply);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (supply + amount > PUBLIC_SUPPLY) throw new Error("public cap exceeded");
  return requiredBackingSats(supply + amount) - requiredBackingSats(supply);
}

/** Gross backing payout to redeem `amount` tokens from `supply` (reverse movement). */
export function grossRedeem(supply: DisplayTokens, amount: DisplayTokens): Sats {
  assertSupplyInRange(supply);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (amount > supply) throw new Error("redeem amount exceeds issued supply");
  return requiredBackingSats(supply) - requiredBackingSats(supply - amount);
}

/** Full backing BUY quote (buyer pays gross + fee). */
export function quoteBuy(
  supply: DisplayTokens,
  amount: DisplayTokens,
  feeConfig: CoveFeeConfig = COVE_FEE_CONFIG,
): Quote {
  const gross = grossBuy(supply, amount);
  const fee = deterministicFee(gross, feeConfig.buyFeeBps);
  return { gross, fee, net: gross + fee };
}

/** Full backing REDEEM quote (seller receives gross - fee). */
export function quoteRedeem(
  supply: DisplayTokens,
  amount: DisplayTokens,
  feeConfig: CoveFeeConfig = COVE_FEE_CONFIG,
): Quote {
  const gross = grossRedeem(supply, amount);
  const fee = deterministicFee(gross, feeConfig.redeemFeeBps);
  return { gross, fee, net: gross - fee };
}
