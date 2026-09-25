/**
 * Deterministic OHLCV series for the demo charts.
 *
 * The trend is derived from Cove's actual issuance curve — a 20-stage staircase
 * running 500 → 149,731 sats per million tokens — so the shape a reviewer sees
 * matches what trading a token up the curve would really produce.
 *
 * Noise comes from a seeded PRNG rather than Math.random, so a given token and
 * interval always render the same chart. A design fixture that reshuffles on
 * every reload cannot be reviewed or screenshotted.
 *
 * The series is generated directly at the requested interval rather than rolled
 * up from a fine base: a day candle needs a day of history behind it, and
 * holding 90 days of ten-minute candles in memory to draw 90 daily ones is
 * waste the browser pays for on every page load.
 */

import { BUCKET_MS, type Interval, type OhlcCandle } from "./ohlc";

export type Candle = OhlcCandle;

/** Frozen stage prices, sats per 1,000,000 tokens (COVE geometric20). */
const STAGE_PRICES = [
  500, 675, 911, 1_230, 1_661, 2_242, 3_027, 4_086, 5_516, 7_447,
  10_053, 13_572, 18_322, 24_735, 33_392, 45_079, 60_857, 82_157, 110_912, 149_731,
];

/** xorshift32 — small, fast, and deterministic for a given seed. */
function makeRng(seed: number) {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100_000) / 100_000;
  };
}

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build `count` candles at `interval` for a token sitting at `stage` on the
 * curve. Prices are sats per 1,000,000 tokens — the unit Cove quotes in.
 *
 * `now` is injected so the caller controls the right edge of the series; the
 * default is the current time, which is what a live chart wants.
 */
export function demoCandles(
  tokenKey: string,
  stage: number,
  interval: Interval,
  count = 140,
  now: number = Date.now(),
): Candle[] {
  // Seed on the interval too, so switching intervals is a different sample of
  // the same walk rather than the identical bar pattern at a new width.
  const rng = makeRng(seedFrom(`${tokenKey}:${interval}`));
  const width = BUCKET_MS[interval];
  const out: Candle[] = [];

  // Walk from an earlier stage up to the token's current one across the window.
  const endIdx = Math.max(0, Math.min(stage - 1, STAGE_PRICES.length - 1));
  const startIdx = Math.max(0, endIdx - 6);
  const startPrice = STAGE_PRICES[startIdx]!;
  const endPrice = STAGE_PRICES[endIdx]!;

  // Align the right edge to a bucket boundary so candles land where the API
  // would have put them.
  const lastBucket = Math.floor(now / width) * width;
  const startTs = lastBucket - (count - 1) * width;

  let prev = startPrice;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 1;
    const target = startPrice + (endPrice - startPrice) * Math.pow(t, 1.6);

    // ±6% jitter, with wider wicks now and then so it does not look synthetic.
    const close = Math.max(1, target * (1 + (rng() - 0.5) * 0.12));
    const open = prev;
    const spread = Math.abs(close - open) + target * (0.01 + rng() * 0.04);
    const high = Math.max(open, close) + spread * rng();
    const low = Math.max(1, Math.min(open, close) - spread * rng());

    // Volume rises with price and spikes on the larger moves.
    const move = Math.abs(close - open) / Math.max(open, 1);
    const scale = width / BUCKET_MS["10m"]; // wider buckets hold more trades
    const volume = Math.round((0.4 + rng()) * 400_000 * scale * (1 + move * 14));

    out.push({
      timestamp: startTs + i * width,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
      trades: 2 + Math.round(rng() * 9 * Math.min(scale, 12)),
    });
    prev = close;
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
