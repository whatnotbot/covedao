import { sql } from "drizzle-orm";
import type { Database } from "@crclaunch/db";
import type { HealthReport } from "@crclaunch/cove-indexer/v3";

/**
 * Runtime readiness probes (§P1-1). These are REAL probes — a committed hash
 * present in the environment, the indexer's computed health/state root, and the
 * worker's advisory lock — never hardcoded `true`. Every missing/unreachable
 * signal fails closed.
 */

const HEX64 = /^[0-9a-f]{64}$/i;

/** Normalize a committed hash (profile / state-root / release-manifest) to lowercase 64-hex, or null. */
export function committedHash(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return HEX64.test(s) ? s : null;
}

export interface IndexerProbeEvaluation {
  indexerHealthy: boolean;
  stateRootVerified: boolean;
  stateRoot: string;
}

/**
 * Map an indexer health report + the committed expected state root to the two
 * readiness flags. A non-HEALTHY indexer, a missing committed root, or a root
 * mismatch all fail closed.
 */
export function evaluateIndexerProbe(health: HealthReport | null, expectedStateRoot: string | null): IndexerProbeEvaluation {
  const indexerHealthy = health?.health === "HEALTHY";
  const stateRoot = health?.stateRoot ?? "";
  const stateRootVerified =
    indexerHealthy && expectedStateRoot !== null && stateRoot !== "" && stateRoot.toLowerCase() === expectedStateRoot;
  return { indexerHealthy, stateRootVerified, stateRoot };
}

/**
 * The Postgres advisory-lock key a V3 worker holds for its network. One per
 * network: testnet and mainnet used to share key 3, so a worker for one could
 * block (or be mistaken for) the other on a shared database.
 */
export function workerLockKey(network: string): number {
  const keys: Record<string, number> = { regtest: 1, signet: 2, testnet: 3, mainnet: 4 };
  const key = keys[network];
  if (key === undefined) throw new Error(`no worker lock key for network "${network}"`);
  return key;
}

/** The worker is healthy iff it currently holds the per-network advisory lock. */
export async function probeWorkerLock(db: Database, network: string): Promise<boolean> {
  const key = workerLockKey(network);
  try {
    const res = await db.execute(
      sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = ${key} AND objsubid = 1) AS held`,
    );
    const rows = res.rows as Array<{ held: boolean }>;
    return rows[0]?.held === true;
  } catch {
    return false;
  }
}
