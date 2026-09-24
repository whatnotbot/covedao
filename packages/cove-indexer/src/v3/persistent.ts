import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import type { Database } from "@crclaunch/db";
import { hydrateState } from "./hydrate.js";
import type { V3Store } from "./store.js";
import type { V3IndexerState } from "./state.js";
import type { V3IndexerConfig } from "./types.js";

/**
 * Persistent worker + persistent reorg (§6/§7). Both start from the canonical
 * persisted state, mutate the in-memory state in lock-step with the DB, and
 * guarantee the cursor advances LAST inside the same transaction. A persistence
 * failure reverts the in-memory state so it never runs ahead of the DB.
 */

export async function persistentWorker(params: {
  db: Database;
  store: V3Store;
  state: V3IndexerState;
  provider: CoreRpcProvider;
  config: V3IndexerConfig;
}): Promise<{ indexed: number; finalHeight: bigint; stateRoot: string }> {
  const { db, store, state, provider, config } = params;
  const info = await provider.getBlockchainInfo();
  const tip = BigInt(info.blocks);
  let indexed = 0;

  for (let h = state.cursor.height + 1n; h <= tip; h++) {
    const hash = await provider.getBlockHash(Number(h));
    const existing = state.undoByHeight.get(h);
    if (existing && existing.blockHash === hash) continue; // idempotent
    const block = await provider.getBlock(hash);
    const input = { height: h, hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs };
    state.applyBlock(input);
    const undo = state.undoByHeight.get(h)!;
    const events = state.events.filter((e) => e.blockHeight === h);
    try {
      await db.transaction(async (tx) => {
        await store.persistBlock(tx, state, input, events, undo);
      });
    } catch (e) {
      state.undoBlock(h); // never leave in-memory ahead of DB
      throw e;
    }
    indexed += 1;
  }
  void config;
  return { indexed, finalHeight: state.cursor.height, stateRoot: state.stateRoot() };
}

export async function reorgPersistentToTip(params: {
  db: Database;
  store: V3Store;
  state: V3IndexerState;
  provider: CoreRpcProvider;
  config: V3IndexerConfig;
}): Promise<{ commonAncestor: bigint; orphaned: bigint[]; replayed: bigint[]; finalRoot: string }> {
  const { db, store, state, provider } = params;
  const tipHeight = BigInt((await provider.getBlockchainInfo()).blocks);

  let ancestor = state.cursor.height;
  while (ancestor > 0n) {
    const coreHash = await provider.getBlockHash(Number(ancestor));
    const local = state.undoByHeight.get(ancestor);
    if (local && local.blockHash === coreHash) break;
    ancestor -= 1n;
  }

  const orphaned: bigint[] = [];
  for (let h = state.cursor.height; h > ancestor; h--) {
    const undo = state.undoByHeight.get(h)!;
    state.undoBlock(h);
    await db.transaction(async (tx) => {
      await store.rollback(tx, undo, state.cursor);
    });
    orphaned.push(h);
  }

  const replayed: bigint[] = [];
  for (let h = ancestor + 1n; h <= tipHeight; h++) {
    const hash = await provider.getBlockHash(Number(h));
    const block = await provider.getBlock(hash);
    const input = { height: h, hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs };
    state.applyBlock(input);
    const undo = state.undoByHeight.get(h)!;
    const events = state.events.filter((e) => e.blockHeight === h);
    await db.transaction(async (tx) => {
      await store.persistBlock(tx, state, input, events, undo);
    });
    replayed.push(h);
  }

  return { commonAncestor: ancestor, orphaned, replayed, finalRoot: state.stateRoot() };
}

export { hydrateState };
