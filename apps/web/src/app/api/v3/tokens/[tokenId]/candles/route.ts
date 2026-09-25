import { ok, fail, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { bucketTrades, summarize, BUCKET_MS, type Interval } from "@/lib/ohlc";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@crclaunch/db";

export const dynamic = "force-dynamic";

const INTERVALS = Object.keys(BUCKET_MS) as Interval[];
/** Enough candles to fill the chart without letting a caller pull the whole table. */
const MAX_TRADES = 5_000;

/**
 * OHLC price history for one token, derived from settled peer-to-peer trades.
 *
 * Only canonical trades count: a fill on a block that was later reorganised out
 * has `canonical = false` and must not appear in a price series.
 *
 * The time axis is `createdAt` — when the indexer observed the trade — because
 * block timestamps are not currently stored. At one block every ten minutes the
 * two are close, but they are not the same thing, and the response says so in
 * `timeBasis` rather than letting a caller assume block time.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const limited = checkRateLimit(req, "read-candles");
    if (limited) return limited;

    const { tokenId } = await params;
    const url = new URL(req.url);
    const raw = url.searchParams.get("interval") ?? "1h";
    if (!INTERVALS.includes(raw as Interval)) {
      return fail("BAD_INTERVAL", `interval must be one of ${INTERVALS.join(", ")}`, 400);
    }
    const interval = raw as Interval;

    const { db, config } = getV3Services();
    const rows = await db
      .select({
        amountAtoms: schema.coveV3MarketTrades.amountAtoms,
        totalPriceSats: schema.coveV3MarketTrades.totalPriceSats,
        createdAt: schema.coveV3MarketTrades.createdAt,
      })
      .from(schema.coveV3MarketTrades)
      .where(
        and(
          eq(schema.coveV3MarketTrades.network, config.network),
          eq(schema.coveV3MarketTrades.tokenId, tokenId),
          eq(schema.coveV3MarketTrades.canonical, true),
        ),
      )
      .orderBy(asc(schema.coveV3MarketTrades.blockHeight))
      .limit(MAX_TRADES);

    const candles = bucketTrades(
      rows.map((r) => ({
        timestamp: r.createdAt.getTime(),
        amountAtoms: r.amountAtoms,
        totalPriceSats: r.totalPriceSats,
      })),
      interval,
    );

    return ok({
      tokenId,
      interval,
      /** Price unit for every OHLC value below. */
      unit: "sats-per-1m-tokens",
      timeBasis: "indexer-observed",
      truncated: rows.length >= MAX_TRADES,
      candles,
      summary: summarize(candles),
    });
  } catch (e) {
    return handleError(e);
  }
}
