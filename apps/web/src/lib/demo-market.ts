import { demoCandles } from "./demo-candles";
import type { MarketSummary } from "@/components/MarketStats";
import type { Sale } from "@/components/SalesFeed";

/**
 * A populated market payload for `?demo=1`, derived from the same deterministic
 * candle fixture the chart uses so the header, the chart and the sales feed all
 * tell one story.
 *
 * Seeded per ticker, so the page renders identically on every reload and can
 * actually be reviewed.
 */

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100_000) / 100_000;
  };
}

const TOTAL_SUPPLY_TOKENS = 1_000_000_000;

export function demoMarket(
  ticker: string,
  curveStage: number,
  asks: { unitPriceSats: number }[],
): MarketSummary & { recentSales: Sale[] } {
  const r = rng(`${ticker}:market`);
  const candles = demoCandles(ticker, curveStage, "1h", 140);
  const last = candles[candles.length - 1]!;
  const dayOpen = candles[Math.max(0, candles.length - 24)]!.open;

  // One sale per candle, priced inside that candle's range.
  const sales: Sale[] = candles.slice(-160).map((c, i) => {
    const unit = c.low + (c.high - c.low) * r();
    const tokens = Math.round((10_000 + r() * 240_000) / 10) * 10;
    const totalSats = Math.max(1, Math.round((unit * tokens) / 1_000_000));
    const hex = "0123456789abcdef";
    let txid = "";
    for (let k = 0; k < 64; k++) txid += hex[Math.floor(r() * 16)];
    return {
      txid,
      blockHeight: String(968_000 + i),
      at: new Date(c.timestamp).toISOString(),
      amountTokens: tokens,
      unitPriceSats: Math.round(unit * 100) / 100,
      totalPriceSats: String(totalSats),
    };
  });

  const vol = (from: number) =>
    sales
      .filter((s) => Date.parse(s.at) >= Date.now() - from)
      .reduce((a, s) => a + BigInt(s.totalPriceSats), 0n);

  const week = vol(7 * 86_400_000);
  const prevWeek = (week * 13n) / 10n; // volume was higher a week ago

  return {
    floorSats: asks.length ? Math.min(...asks.map((a) => a.unitPriceSats)) : null,
    lastPriceSats: last.close,
    change24hPct: dayOpen > 0 ? ((last.close - dayOpen) / dayOpen) * 100 : null,
    marketCapSats: Math.round((last.close * TOTAL_SUPPLY_TOKENS) / 1_000_000),
    volume7dSats: week.toString(),
    volume7dChangePct: prevWeek === 0n ? null : (Number(week - prevWeek) / Number(prevWeek)) * 100,
    highSats: Math.max(...candles.map((c) => c.high)),
    lowSats: Math.min(...candles.map((c) => c.low)),
    trades: sales.length,
    buyers: Math.round(sales.length * (0.55 + r() * 0.25)),
    recentSales: [...sales].reverse(),
  };
}
