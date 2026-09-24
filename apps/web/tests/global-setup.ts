import { fund, mine, IDENTITIES } from "./v3-rpc";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

/**
 * E2E global setup: mine 101 blocks into the test wallet (coinbase maturity),
 * fund deterministic Alice/Bob/Carol regtest wallets with real BTC, confirm the
 * funding, then wait for the V3 worker to catch up (HEALTHY) before tests run.
 * Token creation happens through real Cove transactions — never seeded rows.
 */
export default async function globalSetup() {
  await mine(101);
  const wallets = [IDENTITIES.alice, IDENTITIES.bob, IDENTITIES.carol];
  for (const w of wallets) {
    await fund(w.address, 5);
  }
  await mine(1);
  // Wait for the worker to index everything (health gate requires HEALTHY).
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/v3/status`);
      const j = (await r.json()) as { ok?: boolean; data?: { indexer?: { health?: string; indexedHeight?: string }; core?: { height?: string } } };
      if (j.ok && j.data?.indexer?.health === "HEALTHY") return;
      if (j.ok && j.data?.core?.height && j.data?.indexer?.indexedHeight && BigInt(j.data.core.height) - BigInt(j.data.indexer.indexedHeight) <= 2n) return;
    } catch {
      // web app may still be starting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("indexer did not become HEALTHY after global setup");
}
