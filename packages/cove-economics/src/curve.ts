import type { DisplayTokens, Sats } from "@crclaunch/curve";

/**
 * Deterministic integer-only bonding-curve candidates for the Cove public
 * launch. All arithmetic is bigint; no floating point.
 *
 * Units:
 *   supply/amount: display tokens (1 token = 1e8 atoms)
 *   price: sats per 1,000,000 display tokens (sats/M)
 *   cost/raise/reserve: satoshis
 *
 * A curve is defined by `priceAt(supply)` and `costToBuy(supply, amount)`.
 * `costToBuy` must be the exact integral of the price curve (path-independent),
 * rounded UP to the nearest sat so a buyer can never under-pay.
 */

export const PUBLIC_SUPPLY = 840_000_000n; // display tokens
export const TOTAL_SUPPLY = 1_000_000_000n;
export const RESERVED = 160_000_000n;
export const PRICE_UNIT = 1_000_000n; // tokens per price unit

export interface Curve {
  id: string;
  name: string;
  /** Simplicity operation complexity (honest estimate). */
  complexity: string;
  /** Price in sats per 1M tokens at a given supply (display tokens). */
  priceAt(supply: DisplayTokens): Sats;
  /** Exact cost in sats to buy `amount` tokens from `supply` (ceil-rounded). */
  costToBuy(supply: DisplayTokens, amount: DisplayTokens): Sats;
}

function ceilDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  if (n <= 0n) return 0n;
  return (n + d - 1n) / d;
}

/** Sum of integers [a..b] (a,b token amounts). */
function sumRange(a: bigint, b: bigint): bigint {
  // sum_{i=a}^{b} i = (a+b)(b-a+1)/2
  const n = b - a + 1n;
  return ((a + b) * n) / 2n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve 1: existing 20-stage geometric step curve
// ─────────────────────────────────────────────────────────────────────────────
const STAGE_PRICES: readonly bigint[] = [
  500n,
  675n,
  912n,
  1_231n,
  1_661n,
  2_243n,
  3_027n,
  4_087n,
  5_517n,
  7_447n,
  10_054n,
  13_572n,
  18_323n,
  24_735n,
  33_393n,
  45_080n,
  60_857n,
  82_157n,
  110_912n,
  149_731n,
];
const TOKENS_PER_STAGE = 42_000_000n;

function stageAt(supply: DisplayTokens): number {
  if (supply >= PUBLIC_SUPPLY) return STAGE_PRICES.length - 1;
  return Number(supply / TOKENS_PER_STAGE);
}

export const geometric20: Curve = {
  id: "geometric20",
  name: "20-stage geometric step (existing)",
  complexity:
    "20-entry constant lookup + conditional stage dispatch; per-chunk ceilDiv (multiply + divide)",
  priceAt(supply) {
    return STAGE_PRICES[stageAt(supply)]!;
  },
  costToBuy(supply, amount) {
    let remaining = amount;
    let s = supply;
    let cost = 0n;
    while (remaining > 0n) {
      const stage = stageAt(s);
      const stageEnd = (BigInt(stage) + 1n) * TOKENS_PER_STAGE;
      const inStage = stageEnd - s;
      const chunk = remaining < inStage ? remaining : inStage;
      cost += ceilDiv(chunk * STAGE_PRICES[stage]!, PRICE_UNIT);
      s += chunk;
      remaining -= chunk;
    }
    return cost;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Curve 2: piecewise-linear (continuous linear ramp) 500 → 150,000 sats/M
// ─────────────────────────────────────────────────────────────────────────────
const P0 = 500n;
const P1 = 150_000n;
const RAMP = P1 - P0; // sats/M over the full public supply

export const linearRamp: Curve = {
  id: "linear",
  name: "piecewise-linear ramp (500 → 150k sats/M)",
  complexity: "one multiply_64 + add + one constant division (128-bit); very Simplicity-friendly",
  priceAt(supply) {
    const capped = supply > PUBLIC_SUPPLY ? PUBLIC_SUPPLY : supply;
    return P0 + (RAMP * capped) / PUBLIC_SUPPLY;
  },
  costToBuy(supply, amount) {
    // ∫_{s}^{s+n} (P0 + RAMP·x/S) dx / 1e6  =  [P0·n + RAMP·(n²+2sn)/(2S)] / 1e6
    // common denominator 2·S·1e6
    const n = amount;
    const s = supply;
    const num = P0 * n * 2n * PUBLIC_SUPPLY + RAMP * (n * n + 2n * s * n);
    const den = 2n * PUBLIC_SUPPLY * PRICE_UNIT;
    return ceilDiv(num, den);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Curve 3: quadratic (convex) 500 → 150,000 sats/M
// ─────────────────────────────────────────────────────────────────────────────
const QK = RAMP; // coefficient for (s/S)² scaling

export const quadratic: Curve = {
  id: "quadratic",
  name: "quadratic convex (500 → 150k sats/M)",
  complexity:
    "multiply_64 (square) + multiply_64 + add; 3 multiplies + divide; feasible but heavier",
  priceAt(supply) {
    const capped = supply > PUBLIC_SUPPLY ? PUBLIC_SUPPLY : supply;
    return P0 + (QK * capped * capped) / (PUBLIC_SUPPLY * PUBLIC_SUPPLY);
  },
  costToBuy(supply, amount) {
    // ∫ price = P0·n + QK/S² · ((s+n)³ - s³)/3
    const n = amount;
    const s = supply;
    const sCube = s * s * s;
    const eCube = (s + n) * (s + n) * (s + n);
    const num = P0 * n * 3n * PUBLIC_SUPPLY * PUBLIC_SUPPLY + QK * (eCube - sCube);
    const den = 3n * PUBLIC_SUPPLY * PUBLIC_SUPPLY * PRICE_UNIT;
    return ceilDiv(num, den);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Curve 4: two-segment linear (kink at 50% supply) — low-complexity integer
// ─────────────────────────────────────────────────────────────────────────────
const KINK = PUBLIC_SUPPLY / 2n; // 420M
const SEG0_START = 500n;
const SEG0_END = 20_000n; // sats/M at kink
const SEG1_START = 20_000n;
const SEG1_END = 150_000n;

function twoSegPriceAt(supply: DisplayTokens): Sats {
  if (supply <= KINK) {
    return SEG0_START + ((SEG0_END - SEG0_START) * supply) / KINK;
  }
  const beyond = supply - KINK;
  return SEG1_START + ((SEG1_END - SEG1_START) * beyond) / (PUBLIC_SUPPLY - KINK);
}

export const twoSegmentLinear: Curve = {
  id: "twoSegLinear",
  name: "two-segment linear (kink at 50%)",
  complexity: "branch on supply vs kink + one multiply_64 + divide; Simplicity-friendly",
  priceAt: twoSegPriceAt,
  costToBuy(supply, amount) {
    const end = supply + amount;
    // integrate segment 0
    let cost = 0n;
    const s0 = supply < KINK ? supply : KINK;
    const e0 = end < KINK ? end : KINK;
    if (e0 > s0) {
      // linear on [s0, e0]: slope m0 = (SEG0_END - SEG0_START)/KINK
      const n = e0 - s0;
      const m = SEG0_END - SEG0_START;
      const num = SEG0_START * n * 2n * KINK + m * (n * n + 2n * s0 * n);
      cost += ceilDiv(num, 2n * KINK * PRICE_UNIT);
    }
    if (end > KINK) {
      const s1 = supply < KINK ? KINK : supply;
      const n = end - s1;
      const m = SEG1_END - SEG1_START;
      const segLen = PUBLIC_SUPPLY - KINK;
      const beyond = s1 - KINK;
      const num = SEG1_START * n * 2n * segLen + m * (n * n + 2n * beyond * n);
      cost += ceilDiv(num, 2n * segLen * PRICE_UNIT);
    }
    return cost;
  },
};

export const CURVES: Curve[] = [geometric20, linearRamp, quadratic, twoSegmentLinear];

export { sumRange };
