import { eq } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { V3IndexerState } from "./state.js";
import type { V3Store } from "./store.js";
import { persistentWorker } from "./persistent.js";
import type { V3IndexerConfig } from "./types.js";

/**
 * REAL persistent reindex (§6). Rebuilds ONLY the derived V3 chain projection
 * (cove_v3_*) from canonical Bitcoin, preserving off-chain application metadata.
 * rebuilding=true during the rebuild; set false only after the final root is
 * verified. A partial/failed rebuild never reports HEALTHY.
 */
export async function reindexDb(params: {
  db: Database;
  store: V3Store;
  provider: CoreRpcProvider;
  config: V3IndexerConfig;
  network: string;
}): Promise<{ finalHeight: bigint; stateRoot: string }> {
  const { db, store, provider, config, network } = params;

  await db.transaction(async (tx) => {
    await tx.insert(schema.coveV3Cursor).values({ network, height: 0n, blockHash: "", stateRoot: "", rebuilding: true })
      .onConflictDoUpdate({ target: schema.coveV3Cursor.network, set: { rebuilding: true } });
  });

  // clear derived V3 chain projection only (application metadata in other tables survives)
  await db.transaction(async (tx) => {
    await tx.delete(schema.coveV3Events).where(eq(schema.coveV3Events.network, network));
    await tx.delete(schema.coveV3Undo).where(eq(schema.coveV3Undo.network, network));
    await tx.delete(schema.coveV3TokenUtxos).where(eq(schema.coveV3TokenUtxos.network, network));
    await tx.delete(schema.coveV3BackingStates).where(eq(schema.coveV3BackingStates.network, network));
    await tx.delete(schema.coveV3Tokens).where(eq(schema.coveV3Tokens.network, network));
    await tx.delete(schema.coveV3Blocks).where(eq(schema.coveV3Blocks.network, network));
  });

  const state = new V3IndexerState(config);
  const result = await persistentWorker({ db, store, state, provider, config });

  await db.transaction(async (tx) => {
    await tx.update(schema.coveV3Cursor)
      .set({ rebuilding: false, stateRoot: result.stateRoot, height: result.finalHeight, blockHash: state.cursor.blockHash })
      .where(eq(schema.coveV3Cursor.network, network));
  });

  return result;
}
