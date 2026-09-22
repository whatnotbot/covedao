import type { ChildProcess } from "node:child_process";

export default async function globalTeardown() {
  const worker = (globalThis as unknown as { __worker: ChildProcess | null }).__worker;
  if (worker) worker.kill("SIGTERM");
}
