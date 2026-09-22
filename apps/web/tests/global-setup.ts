import { execSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

let worker: ChildProcess | null = null;

export default async function globalSetup() {
  // Ensure the database is migrated from zero.
  execSync("pnpm --filter @crclaunch/db db:migrate", { cwd: ROOT, stdio: "inherit" });

  // Start the indexer worker so mock blocks are mined and events indexed.
  worker = spawn(
    "pnpm",
    ["--filter", "@crclaunch/worker", "start"],
    {
      cwd: ROOT,
      env: { ...process.env, MOCK_BLOCK_INTERVAL_MS: "500" },
      stdio: "inherit",
    },
  );

  // Wait for the worker to seed the mock chain.
  await new Promise((r) => setTimeout(r, 3000));

  (globalThis as unknown as { __worker: ChildProcess | null }).__worker = worker;
}
