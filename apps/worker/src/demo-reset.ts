import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { Redis } from "ioredis";
import { loadConfig } from "@crclaunch/config";
import { createDb, resetAllTables } from "@crclaunch/db";
import {
  MockChainNode,
  RedisMockStorage,
  seedMockChain,
  createInitialState,
} from "@crclaunch/protocol";
import { syncMockToDb } from "./sync.js";

async function main() {
  const config = loadConfig(process.env);
  if (config.network !== "mock" || config.nodeEnv === "production") {
    console.error("[demo:reset] refused: requires network=mock and NODE_ENV != production.");
    process.exit(1);
  }
  const db = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  // 1. Reset mock chain state (shared via Redis).
  await redis.del("mock:chain:state", "mock:chain:lock");
  const node = new MockChainNode(new RedisMockStorage(redis), config.network);
  await node.init();
  await node.mutate((state) => {
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

  // 2. Seed demo projects (FROG at a chosen stage, plus a graduated token).
  await seedMockChain(node);

  // 3. Reset the DB projection.
  await resetAllTables(db);

  // 4. Re-sync the seeded chain into the DB so /demo works immediately.
  await node.mineBlock();
  await syncMockToDb(db, node, config.network);

  console.log("✅ Demo reset complete. Seed tokens are live. Open /demo.");
  await redis.quit();
  process.exit(0);
}

main().catch((e) => {
  console.error("[demo:reset] fatal:", e);
  process.exit(1);
});
