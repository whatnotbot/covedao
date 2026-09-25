/**
 * OHLC bucketing for token price history.
 *
 * Cove quotes every token in **sats per 1,000,000 tokens**, so a trade of
 * `amountAtoms` for `totalPriceSats` has unit price:
 *
 *     price = totalPriceSats × 1e6 × ATOMS_PER_TOKEN ÷ amountAtoms
 *
 * The multiplication is done in BigInt before the single divide, so the result
 * never loses precision to intermediate floating point — the same discipline the
 * curve itself uses.
 *
 * BOTH kinds of trade count: peer-to-peer fills and buys or sells against the
 * backing vault. A vault trade is priced by the deterministic stage table
 * rather than by a market, but it is still satoshis someone actually paid for
 * tokens, and it is the ONLY kind most tokens have — excluding it left every
 * token that had merely minted with a blank chart, which reads as broken
 * rather than as new. The API reports the two counts separately so a caller
 * that wants only market prices can still have them.
 */

const ATOMS_PER_TOKEN = 100_000_000n;
const PER = 1_000_000n; // quote unit: 1M tokens
/** Scale before the divide so two decimal places survive as an integer. */
const PRECISION = 100n;

export interface Trade {
  /** Unix milliseconds the trade confirmed. */
  timestamp: number;
  amountAtoms: string | bigint;
  totalPriceSats: string | bigint;
}

export type OhlcCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Tokens traded in the bucket, whole tokens. */
  volume: number;
  /** Number of settled trades in the bucket. */
  trades: number;
};

/** Sats per 1,000,000 tokens for one trade, to two decimal places. */
export function unitPriceSats(amountAtoms: string | bigint, totalPriceSats: string | bigint): number {
  const atoms = BigInt(amountAtoms);
  if (atoms <= 0n) return 0;
  const scaled = (BigInt(totalPriceSats) * PER * ATOMS_PER_TOKEN * PRECISION) / atoms;
  return Number(scaled) / Number(PRECISION);
}

export const BUCKET_MS = {
  "10m": 10 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
} as const;

export type Interval = keyof typeof BUCKET_MS;

/**
 * Fold trades into fixed time buckets.
 *
 * Buckets are aligned to the epoch so the same trade always lands in the same
 * bucket regardless of when the query runs — two viewers loading the chart a
 * minute apart see identical candles.
 *
 * Empty buckets are filled forward as flat candles at the previous close
 * rather than omitted, so a gap in trading reads as a quiet market instead of
 * a compressed time axis that misleads about how fast price moved.
 */
export function bucketTrades(trades: Trade[], interval: Interval): OhlcCandle[] {
  if (trades.length === 0) return [];
  const width = BUCKET_MS[interval];
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const byBucket = new Map<number, { prices: number[]; tokens: number; count: number }>();
  for (const t of sorted) {
    const key = Math.floor(t.timestamp / width) * width;
    const price = unitPriceSats(t.amountAtoms, t.totalPriceSats);
    if (price <= 0) continue;
    const slot = byBucket.get(key) ?? { prices: [], tokens: 0, count: 0 };
    slot.prices.push(price);
    slot.tokens += Number(BigInt(t.amountAtoms) / ATOMS_PER_TOKEN);
    slot.count += 1;
    byBucket.set(key, slot);
  }
  if (byBucket.size === 0) return [];

  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  const out: OhlcCandle[] = [];
  let prevClose = byBucket.get(keys[0]!)!.prices[0]!;

  for (let ts = keys[0]!; ts <= keys[keys.length - 1]!; ts += width) {
    const slot = byBucket.get(ts);
    if (!slot) {
      out.push({
        timestamp: ts,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
        trades: 0,
      });
      continue;
    }
    const open = slot.prices[0]!;
    const close = slot.prices[slot.prices.length - 1]!;
    out.push({
      timestamp: ts,
      open,
      close,
      high: Math.max(...slot.prices),
      low: Math.min(...slot.prices),
      volume: slot.tokens,
      trades: slot.count,
    });
    prevClose = close;
  }
  return out;
}

/** Header stats for the strip above a chart, over the whole returned series. */
export function summarize(candles: OhlcCandle[]) {
  if (candles.length === 0) return null;
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  return {
    last: last.close,
    open: first.open,
    changePct: first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0,
    high: Math.max(...candles.map((c) => c.high)),
    low: Math.min(...candles.map((c) => c.low)),
    volume: candles.reduce((a, c) => a + c.volume, 0),
    trades: candles.reduce((a, c) => a + c.trades, 0),
  };
}
