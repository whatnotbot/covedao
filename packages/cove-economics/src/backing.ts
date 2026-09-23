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

/** Typed backing/economics error. */
export class BackingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BackingError";
    this.code = code;
  }
}

function assertSupplyInRange(supply: DisplayTokens): void {
  if (supply < 0n) throw new BackingError("INVALID_SUPPLY", "supply must be non-negative");
  if (supply > PUBLIC_SUPPLY)
    throw new BackingError("PUBLIC_CAP_EXCEEDED", "supply exceeds public cap");
}

/**
 * Economic-validity rule (§1.1): a positive quantity whose R-delta rounds to
 * zero satoshis is non-executable. One canonical R(s) is preserved; we never
 * invent a different R for buys vs redeems and never add fake backing.
 */
function assertPositiveDelta(gross: Sats): void {
  if (gross < 1n) {
    throw new BackingError(
      "ECONOMIC_DUST",
      "zero backing delta: positive quantity produced a 0-sat R-delta",
    );
  }
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
  if (amount <= 0n) throw new BackingError("INVALID_AMOUNT", "amount must be positive");
  if (supply + amount > PUBLIC_SUPPLY)
    throw new BackingError("PUBLIC_CAP_EXCEEDED", "public cap exceeded");
  const gross = requiredBackingSats(supply + amount) - requiredBackingSats(supply);
  assertPositiveDelta(gross);
  return gross;
}

/** Gross backing payout to redeem `amount` tokens from `supply` (reverse movement). */
export function grossRedeem(supply: DisplayTokens, amount: DisplayTokens): Sats {
  assertSupplyInRange(supply);
  if (amount <= 0n) throw new BackingError("INVALID_AMOUNT", "amount must be positive");
  if (amount > supply)
    throw new BackingError("INSUFFICIENT_TOKEN_BALANCE", "redeem amount exceeds issued supply");
  const gross = requiredBackingSats(supply) - requiredBackingSats(supply - amount);
  assertPositiveDelta(gross);
  return gross;
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
