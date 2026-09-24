import "dotenv/config";
import { Client } from "pg";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { createDb } from "@crclaunch/db";
import {
  V3Store,
  persistentWorker,
  reorgPersistentToTip,
  hydrateState,
} from "@crclaunch/cove-indexer/v3";
import { loadV3AppConfig, V3AppService, Metrics } from "@crclaunch/cove-app";
import { GuardianV3Signer } from "@crclaunch/cove-guardian/v3";
import type { V3IndexerConfig } from "@crclaunch/cove-indexer/v3";

/**
 * V3 worker runtime (§84-§86): continuous Core → persistent V3 indexer → market
 * reconcile → app transaction-session reconcile, with a single-owner Postgres
 * advisory lock per network. No MockCRCAdapter, no block mining, no graduation.
 */

const DB_URL = process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

const POLL_MS = Number(process.env.COVE_WORKER_POLL_MS ?? 2000);

async function acquireNetworkLock(network: string): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  // Small deterministic advisory-lock key per network (single-owner guard).
  const key = network === "regtest" ? 1 : network === "signet" ? 2 : 3;
  const res = await client.query("SELECT pg_try_advisory_lock($1)", [key]);
  if (res.rows[0]?.pg_try_advisory_lock !== true) {
    await client.end();
    throw new Error(`another V3 worker owns network "${network}" (advisory lock held)`);
  }
  console.log(`✓ acquired V3 worker advisory lock for ${network}`);
  return client;
}

async function main() {
  if (!DB_URL) throw new Error("COVE_DATABASE_URL is required");
  const config = loadV3AppConfig(process.env);
  if (!config.enabled) throw new Error("COVE_V3_APP_ENABLED is false — refusing to run the V3 worker");

  const lock = await acquireNetworkLock(config.network);
  const provider = new CoreRpcProvider({ url: config.coreRpcUrl, user: config.coreRpcUser, password: config.coreRpcPassword });
  const db = createDb(DB_URL);
  const store = new V3Store(config.network);
  const signer = config.guardianPrivateKey ? GuardianV3Signer.fromPrivateKey(config.guardianPrivateKey) : null;
  const app = new V3AppService(db, provider, config, signer);
  const metrics = new Metrics();

  const indexerConfig: V3IndexerConfig = {
    network: config.network,
    chainIdentity: config.chainIdentity,
    guardianXOnly: config.guardianXOnly,
    recoveryKeyXOnly: config.recoveryKeyXOnly,
    recoveryProfile: config.recoveryProfile,
    feeScript: config.feeScript,
    genesisHeight: config.activationHeight,
  };

  const state = await hydrateState(db, config.network, indexerConfig);
  console.log(`V3 worker started (${config.network}), cursor ${state.cursor.height}`);

  const tick = async () => {
    try {
      // 1. check Core + reorg
      const info = await provider.getBlockchainInfo();
      const coreHeight = BigInt(info.blocks);
      if (state.cursor.height > 0n && state.cursor.height <= coreHeight) {
        const coreHashAtCursor = await provider.getBlockHash(Number(state.cursor.height));
        if (coreHashAtCursor !== state.cursor.blockHash) {
          console.log(`reorg detected at height ${state.cursor.height}; rolling back to tip`);
          await reorgPersistentToTip({ db, store, state, provider, config: indexerConfig });
          metrics.inc("market.confirmations");
        }
      }
      // 2. catch up persistent indexer
      await persistentWorker({ db, store, state, provider, config: indexerConfig });
      // 3. reconcile market
      const market = await app.market.reconcileMarket();
      metrics.gauge("market.listings_active", BigInt(market.confirmed));
      metrics.inc("market.confirmations", market.confirmed);
      // 4. reconcile app tx sessions
      const sessions = await app.reconcileAppSessions();
      metrics.inc("market.broadcasts", sessions.confirmed);
      if (market.confirmed || sessions.confirmed || market.reorged) {
        console.log(`reconciled: market ${JSON.stringify(market)} sessions ${JSON.stringify(sessions)}`);
      }
    } catch (e) {
      console.error("V3 worker tick failed:", e instanceof Error ? e.message : String(e));
    }
  };

  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  void lock;
}

main().catch((e) => {
  console.error("V3 worker failed:", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
