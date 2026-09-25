import { describe, it, expect } from "vitest";
import { unitPriceSats, bucketTrades, summarize, BUCKET_MS } from "./ohlc";

const H = BUCKET_MS["1h"];
const ATOM = 100_000_000n;

describe("unitPriceSats", () => {
  it("quotes sats per 1,000,000 tokens", () => {
    // 1,000,000 tokens for 5,000 sats => 5,000 sats per 1M.
    expect(unitPriceSats(1_000_000n * ATOM, 5_000n)).toBe(5_000);
  });

  it("scales with amount, not with total", () => {
    // Half the tokens for the same sats is twice the unit price.
    expect(unitPriceSats(500_000n * ATOM, 5_000n)).toBe(10_000);
  });

  it("keeps two decimal places without floating-point drift", () => {
    // 3 tokens for 1 sat => 333333.33 sats per 1M, not 333333.3333333333.
    expect(unitPriceSats(3n * ATOM, 1n)).toBe(333_333.33);
  });

  it("returns 0 for a zero or negative amount rather than dividing by zero", () => {
    expect(unitPriceSats(0n, 5_000n)).toBe(0);
    expect(unitPriceSats(-1n, 5_000n)).toBe(0);
  });

  it("accepts string inputs, as they arrive from the database", () => {
    expect(unitPriceSats((1_000_000n * ATOM).toString(), "5000")).toBe(5_000);
  });
});

describe("bucketTrades", () => {
  const t = (timestamp: number, tokens: bigint, sats: bigint) => ({
    timestamp,
    amountAtoms: tokens * ATOM,
    totalPriceSats: sats,
  });

  it("returns nothing for no trades", () => {
    expect(bucketTrades([], "1h")).toEqual([]);
  });

  it("folds trades in one bucket into a single candle", () => {
    const base = 10 * H;
    const out = bucketTrades(
      [
        t(base + 60_000, 1_000_000n, 4_000n), // 4000
        t(base + 120_000, 1_000_000n, 9_000n), // 9000  <- high
        t(base + 180_000, 1_000_000n, 2_000n), // 2000  <- low
        t(base + 240_000, 1_000_000n, 6_000n), // 6000
      ],
      "1h",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      timestamp: base,
      open: 4_000,
      high: 9_000,
      low: 2_000,
      close: 6_000,
      volume: 4_000_000,
      trades: 4,
    });
  });

  it("aligns buckets to the epoch so results do not shift between queries", () => {
    const out = bucketTrades([t(7 * H + 1_234, 1_000_000n, 5_000n)], "1h");
    expect(out[0]!.timestamp).toBe(7 * H);
    expect(out[0]!.timestamp % H).toBe(0);
  });

  it("orders unsorted input before deriving open and close", () => {
    const base = 3 * H;
    const out = bucketTrades(
      [t(base + 300_000, 1_000_000n, 8_000n), t(base + 100_000, 1_000_000n, 1_000n)],
      "1h",
    );
    expect(out[0]!.open).toBe(1_000);
    expect(out[0]!.close).toBe(8_000);
  });

  it("fills quiet buckets forward as flat candles at the previous close", () => {
    const base = 2 * H;
    const out = bucketTrades(
      [t(base, 1_000_000n, 5_000n), t(base + 3 * H, 1_000_000n, 7_000n)],
      "1h",
    );
    expect(out).toHaveLength(4);
    expect(out[1]).toMatchObject({ open: 5_000, high: 5_000, low: 5_000, close: 5_000, volume: 0, trades: 0 });
    expect(out[2]!.close).toBe(5_000);
    expect(out[3]!.close).toBe(7_000);
  });

  it("separates trades into different buckets at a finer interval", () => {
    const base = 4 * H;
    const out = bucketTrades(
      [t(base, 1_000_000n, 5_000n), t(base + 20 * 60_000, 1_000_000n, 7_000n)],
      "10m",
    );
    // 0m and 20m are two 10-minute buckets, with one quiet bucket between.
    expect(out).toHaveLength(3);
    expect(out[0]!.close).toBe(5_000);
    expect(out[1]!.trades).toBe(0);
    expect(out[2]!.close).toBe(7_000);
  });

  it("skips trades that would price at zero rather than emitting a 0 candle", () => {
    const base = 5 * H;
    const out = bucketTrades([{ timestamp: base, amountAtoms: 0n, totalPriceSats: 5_000n }], "1h");
    expect(out).toEqual([]);
  });
});

describe("summarize", () => {
  it("returns null for an empty series", () => {
    expect(summarize([])).toBeNull();
  });

  it("measures change from the first open to the last close", () => {
    const base = 6 * H;
    const candles = bucketTrades(
      [
        { timestamp: base, amountAtoms: 1_000_000n * ATOM, totalPriceSats: 4_000n },
        { timestamp: base + H, amountAtoms: 1_000_000n * ATOM, totalPriceSats: 5_000n },
      ],
      "1h",
    );
    const s = summarize(candles)!;
    expect(s.open).toBe(4_000);
    expect(s.last).toBe(5_000);
    expect(s.changePct).toBeCloseTo(25, 6);
    expect(s.trades).toBe(2);
    expect(s.volume).toBe(2_000_000);
  });
});
