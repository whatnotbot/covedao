import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices } from "@/lib/server";
import { launchMetadataSchema } from "@crclaunch/schemas";
import { getTokenByTicker } from "@crclaunch/db";

export async function POST(req: Request) {
  const { db, adapter, config } = getServices();
  const body = await readJson(req);
  const parsed = launchMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  }
  try {
    const ticker = parsed.data.ticker;
    // 1. local DB
    const local = await getTokenByTicker(db, config.network, ticker);
    if (local) return fail("TICKER_TAKEN", `Ticker ${ticker} is already taken.`, 409);
    // 2. fresh protocol query
    const onChain = await adapter.getTokenByTicker(ticker);
    if (onChain) return fail("TICKER_TAKEN", `Ticker ${ticker} is already taken on-chain.`, 409);
    return ok({ ticker, available: true });
  } catch (e) {
    return handleError(e);
  }
}
