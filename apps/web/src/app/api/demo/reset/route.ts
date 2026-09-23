import { ok, fail } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { resetAllTables } from "@crclaunch/db";
import { seedMockChain, createInitialState } from "@crclaunch/protocol";
import { getConfig } from "@/lib/env";
import { isAdmin } from "@/lib/admin";

/**
 * Reset the demo (mock network only). Destructive: requires a valid admin
 * bearer token and a non-production environment. Returns 404 (not 403) when
 * unavailable so the route's existence is not advertised.
 */
export async function POST(req: Request) {
  const config = getConfig();
  if (config.nodeEnv === "production") return fail("NOT_FOUND", "Not found.", 404);
  if (config.network !== "mock") return fail("NOT_FOUND", "Not found.", 404);
  if (!isAdmin(req, { allowDevBypass: false })) return fail("NOT_FOUND", "Not found.", 404);

  const { redis, node, db } = getServices();
  await initServices();
  await redis.del("mock:chain:state", "mock:chain:lock");
  await node!.mutate((state) => {
    const fresh = createInitialState(config.network);
    state.blocks = fresh.blocks;
    state.mempool = fresh.mempool;
    state.txs = fresh.txs;
    state.tokens = fresh.tokens;
    state.tickerIndex = fresh.tickerIndex;
    state.balances = fresh.balances;
    state.listings = fresh.listings;
    state.events = fresh.events;
    state.platformTreasurySats = 0n;
    state.protocolTreasurySats = 0n;
    state.height = 0n;
  });
  await seedMockChain(node!);
  await resetAllTables(db);
  return ok({ reset: true });
}
