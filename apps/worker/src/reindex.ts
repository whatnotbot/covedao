import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { Redis } from "ioredis";
import { loadConfig } from "@crclaunch/config";
import { createDb } from "@crclaunch/db";
import { MockChainNode, RedisMockStorage } from "@crclaunch/protocol";
import { syncMockToDb } from "./sync.js";

/**
 * Full reindex: re-syncs the DB projection from the mock chain's canonical
 * state. A total DB loss must not imply loss of user funds — projections are
 * reproducible by reindexing.
 */
async function main() {
  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const node = new MockChainNode(new RedisMockStorage(redis), config.network);
  await node.init();
  await syncMockToDb(db, node, config.network);
  console.log(`[reindex] done at height ${await node.getHeight()}`);
  await redis.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error("[reindex] fatal:", err);
  process.exit(1);
});
