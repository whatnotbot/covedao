import { ok, fail } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { resetProjections } from "@crclaunch/db";
import { seedMockChain, createInitialState } from "@crclaunch/protocol";

/**
 * Reset the demo: clear the shared mock chain + projection DB, reseed, and let
 * the worker re-sync. Mainnet modes are never affected (this only runs in DEMO).
 */
export async function POST() {
  const { config, redis, node, db } = getServices();
  await initServices();
  if (config.network !== "mock") {
    return fail("UNAVAILABLE", "Demo reset is only available in demo mode.", 403);
  }
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
  await resetProjections(db);
  return ok({ reset: true });
}
