import { ok, fail, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { bucketTrades, unitPriceSats, type Trade } from "@/lib/ohlc";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@crclaunch/db";

export const dynamic = "force-dynamic";

/** A list page shows tens of tokens; one request must cover all of them. */
const MAX_TOKENS = 100;
/** Points per sparkline. More than this is invisible at 104px wide. */
const POINTS = 32;

/**
 * Recent price series for many tokens at once.
 *
 * Explore and Market render a sparkline per row. Asking for them one at a time
 * would mean tens of round trips per page load, so this takes the whole set of
 * token ids and answers with one query.
 *
 * Each series is the closing price of the last `POINTS` hourly buckets, in sats
 * per 1,000,000 tokens — the same unit and the same bucketing the full chart
 * uses, so a row and its token page never disagree.
 *
 * Tokens that have never traded are returned with an empty array rather than
 * omitted, so the caller can tell "no trades" from "not asked for".
 */
export async function GET(req: Request) {
  try {
    const limited = checkRateLimit(req, "read-sparklines");
    if (limited) return limited;

    const url = new URL(req.url);
    const ids = (url.searchParams.get("tokenIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) return ok({ series: {} });
    if (ids.length > MAX_TOKENS) {
      return fail("TOO_MANY_TOKENS", `at most ${MAX_TOKENS} token ids per request`, 400);
    }

    const { db, config } = getV3Services();
    const rows = await db
      .select({
        tokenId: schema.coveV3MarketTrades.tokenId,
        amountAtoms: schema.coveV3MarketTrades.amountAtoms,
        totalPriceSats: schema.coveV3MarketTrades.totalPriceSats,
        createdAt: schema.coveV3MarketTrades.createdAt,
      })
      .from(schema.coveV3MarketTrades)
      .where(
        and(
          eq(schema.coveV3MarketTrades.network, config.network),
          inArray(schema.coveV3MarketTrades.tokenId, ids),
          eq(schema.coveV3MarketTrades.canonical, true),
        ),
      )
      .orderBy(asc(schema.coveV3MarketTrades.blockHeight));

    const byToken = new Map<string, Trade[]>();
    for (const r of rows) {
      const list = byToken.get(r.tokenId) ?? [];
      list.push({
        timestamp: r.createdAt.getTime(),
        amountAtoms: r.amountAtoms,
        totalPriceSats: r.totalPriceSats,
      });
      byToken.set(r.tokenId, list);
    }

    const series: Record<string, number[]> = {};
    const lastPrice: Record<string, number | null> = {};
    for (const id of ids) {
      const trades = byToken.get(id) ?? [];
      const candles = bucketTrades(trades, "1h").slice(-POINTS);
      series[id] = candles.map((c) => c.close);
      const newest = trades[trades.length - 1];
      lastPrice[id] = newest ? unitPriceSats(newest.amountAtoms, newest.totalPriceSats) : null;
    }

    return ok({ unit: "sats-per-1m-tokens", interval: "1h", series, lastPrice });
  } catch (e) {
    return handleError(e);
  }
}
