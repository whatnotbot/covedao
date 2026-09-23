import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, validateConfig } from "@crclaunch/config";
import { createDb } from "@crclaunch/db";
import { MockChainNode, MockCRCAdapter, RedisMockStorage, seedMockChain } from "@crclaunch/protocol";
import { detectReorg, maybeGraduate, rebuildProjections, syncMockToDb } from "./sync.js";

const QUEUE_NAME = "indexer";
const BLOCK_INTERVAL_MS = Number(process.env.MOCK_BLOCK_INTERVAL_MS ?? 1000);

async function main() {
  const config = loadConfig(process.env);
  validateConfig(config);

  const db = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const network = config.network;

  const storage = new RedisMockStorage(redis);
  const node = new MockChainNode(storage, network);
  await node.init();
  await seedMockChain(node);

  const adapter = new MockCRCAdapter(node);

  const queue = new Queue(QUEUE_NAME, { connection: redis });
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      // On a detected reorg, rebuild the projection from the canonical chain
      // (incremental-after-reorg === clean-reindex). Otherwise incremental sync.
      const reorg = await detectReorg(db, node, network);
      if (reorg) {
        await rebuildProjections(db, node, network);
      } else {
        await syncMockToDb(db, node, network);
      }
      if (network === "mock") {
        await maybeGraduate(db, node, adapter, config, network);
      }
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] sync job ${job?.id} failed:`, err);
  });

  // In mock mode, run a lightweight mining loop: produce a block, then enqueue
  // a sync job. Never index inside the web request lifecycle.
  let timer: ReturnType<typeof setInterval> | null = null;
  if (network === "mock") {
    console.log(`[worker] mock mining loop: 1 block / ${BLOCK_INTERVAL_MS}ms`);
    timer = setInterval(async () => {
      try {
        await node.mineBlock();
        await queue.add("sync", {}, { removeOnComplete: 100, removeOnFail: 100 });
      } catch (err) {
        console.error("[worker] mock mine failed:", err);
      }
    }, BLOCK_INTERVAL_MS);
    // Run one sync immediately so the seed data is visible without waiting.
    await node.mineBlock();
    await queue.add("sync", {});
  }

  const shutdown = async () => {
    if (timer) clearInterval(timer);
    await worker.close();
    await queue.close();
    await redis.quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
