import { ok, fail, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { bucketTrades, unitPriceSats, type Trade } from "@/lib/ohlc";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
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
 * per 1,000,000 tokens — the same unit, the same bucketing AND the same two
 * sources the full chart uses (peer-to-peer fills plus curve trades), so a row
 * and its token page never disagree.
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

    const curveRows = await db
      .select({
        tokenId: schema.coveV3Events.tokenId,
        amountAtoms: schema.coveV3Events.amountAtoms,
        grossSats: schema.coveV3Events.grossSats,
        createdAt: schema.coveV3Events.createdAt,
      })
      .from(schema.coveV3Events)
      .where(
        and(
          eq(schema.coveV3Events.network, config.network),
          inArray(schema.coveV3Events.tokenId, ids),
          eq(schema.coveV3Events.canonical, true),
          eq(schema.coveV3Events.valid, true),
          inArray(schema.coveV3Events.operation, ["MINT", "REDEEM"]),
          isNotNull(schema.coveV3Events.grossSats),
        ),
      )
      .orderBy(asc(schema.coveV3Events.blockHeight));

    const byToken = new Map<string, Trade[]>();
    const push = (tokenId: string, t: Trade) => {
      const list = byToken.get(tokenId) ?? [];
      list.push(t);
      byToken.set(tokenId, list);
    };
    for (const r of rows) {
      push(r.tokenId, {
        timestamp: r.createdAt.getTime(),
        amountAtoms: r.amountAtoms,
        totalPriceSats: r.totalPriceSats,
      });
    }
    for (const r of curveRows) {
      push(r.tokenId!, {
        timestamp: r.createdAt.getTime(),
        amountAtoms: r.amountAtoms!,
        totalPriceSats: r.grossSats!,
      });
    }
    // Both sources are ordered by height independently; one series has to be
    // ordered as a whole before the newest trade means anything.
    for (const list of byToken.values()) list.sort((a, b) => a.timestamp - b.timestamp);

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
