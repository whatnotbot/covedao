import type { Sats, DisplayTokens } from "./types.js";
import {
  GRADUATION_RESERVE_TOKENS,
  PUBLIC_SUPPLY_TOKENS,
  STAGE_PRICES_SATS_PER_MILLION,
  TOTAL_SUPPLY_TOKENS,
  TOKENS_PER_STAGE,
} from "./constants.js";

/**
 * Exact theoretical full-primary-mint raise in sats.
 * Every stage sells exactly TOKENS_PER_STAGE (42,000,000) tokens, and
 * 42,000,000 × price / 1,000,000 = 42 × price exactly (no rounding).
 */
export function getTheoreticalFullRaise(): Sats {
  let total = 0n;
  for (const price of STAGE_PRICES_SATS_PER_MILLION) {
    total += TOKENS_PER_STAGE * price / 1_000_000n;
  }
  return total;
}

/**
 * Optional overrides used to exercise validateCurveConfig's invariant checks
 * in tests. Production always validates the canonical constants.
 */
export interface CurveConfigInput {
  totalSupplyTokens?: DisplayTokens;
  publicSupplyTokens?: DisplayTokens;
  reserveSupplyTokens?: DisplayTokens;
  tokensPerStage?: DisplayTokens;
  stagePrices?: readonly Sats[];
}

/**
 * Validates that a curve configuration is internally consistent. Returns a
 * list of invariant violations (empty when valid).
 */
export function validateCurveConfig(input: CurveConfigInput = {}): string[] {
  const total = input.totalSupplyTokens ?? TOTAL_SUPPLY_TOKENS;
  const publicSupply = input.publicSupplyTokens ?? PUBLIC_SUPPLY_TOKENS;
  const reserve = input.reserveSupplyTokens ?? GRADUATION_RESERVE_TOKENS;
  const tokensPerStage = input.tokensPerStage ?? TOKENS_PER_STAGE;
  const prices = input.stagePrices ?? STAGE_PRICES_SATS_PER_MILLION;

  const problems: string[] = [];
  if (total !== 1_000_000_000n) problems.push("TOTAL_SUPPLY_TOKENS must be 1B.");
  if (publicSupply + reserve !== total) {
    problems.push("public + reserve must equal total supply.");
  }
  if (prices.length !== 20) {
    problems.push("Must be exactly 20 stages.");
  }
  if (prices[0] !== 500n) {
    problems.push("Stage 1 price must be 500.");
  }
  if (prices[19] !== 149_731n) {
    problems.push("Stage 20 price must be 149,731.");
  }
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const cur = prices[i]!;
    if (cur <= prev) problems.push(`Stage ${i + 1} price must exceed stage ${i} price.`);
  }
  const fullRaise = prices.reduce((acc, p) => acc + tokensPerStage * p / 1_000_000n, 0n);
  if (fullRaise !== 24_196_788n) {
    problems.push(`Full raise must be 24,196,788 sats (got ${fullRaise}).`);
  }
  return problems;
}

export function getPublicMintProgress(supply: DisplayTokens): {
  mintedTokens: DisplayTokens;
  totalTokens: DisplayTokens;
  /** Basis points minted (0..10000). */
  bps: number;
} {
  const clamped = supply < 0n ? 0n : supply > PUBLIC_SUPPLY_TOKENS ? PUBLIC_SUPPLY_TOKENS : supply;
  const bps = Number((clamped * 10_000n) / PUBLIC_SUPPLY_TOKENS);
  return { mintedTokens: clamped, totalTokens: PUBLIC_SUPPLY_TOKENS, bps };
}

export function getRemainingPublicSupply(supply: DisplayTokens): DisplayTokens {
  const remaining = PUBLIC_SUPPLY_TOKENS - supply;
  return remaining < 0n ? 0n : remaining;
}
