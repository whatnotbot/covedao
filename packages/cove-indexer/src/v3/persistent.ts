import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import type { Database } from "@crclaunch/db";
import { hydrateState } from "./hydrate.js";
import type { V3Store } from "./store.js";
import type { V3IndexerState } from "./state.js";
import type { V3IndexerConfig } from "./types.js";

/**
 * Persistent worker + persistent reorg (§6/§7). Memory and DB stay in LOCKSTEP:
 * every block is applied to a STAGED clone, persisted, and only on commit is the
 * staged state swapped into the active state. A DB failure therefore never
 * leaves the active in-memory state ahead of (or behind) the DB.
 */

export async function persistentWorker(params: {
  db: Database;
  store: V3Store;
  state: V3IndexerState;
  provider: CoreRpcProvider;
  config: V3IndexerConfig;
}): Promise<{ indexed: number; finalHeight: bigint; stateRoot: string }> {
  const { db, store, state, provider } = params;
  const info = await provider.getBlockchainInfo();
  const tip = BigInt(info.blocks);
  let indexed = 0;

  for (let h = state.cursor.height + 1n; h <= tip; h++) {
    const hash = await provider.getBlockHash(Number(h));
    if (state.undoByHeight.get(h)?.blockHash === hash) continue; // idempotent
    const block = await provider.getBlock(hash);
    const input = { height: h, hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs };

    const staged = state.clone();
    staged.applyBlock(input);
    const undo = staged.undoByHeight.get(h)!;
    const events = staged.events.filter((e) => e.blockHeight === h);

    await db.transaction(async (tx) => {
      await store.persistBlock(tx, staged, input, events, undo);
    });
    state.adopt(staged); // only after DB commit
    indexed += 1;
  }
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
    const staged = state.clone();
    staged.undoBlock(h);
    await db.transaction(async (tx) => {
      await store.rollback(tx, undo, staged.cursor);
    });
    state.adopt(staged); // only after DB commit
    orphaned.push(h);
  }

  const replayed: bigint[] = [];
  for (let h = ancestor + 1n; h <= tipHeight; h++) {
    const hash = await provider.getBlockHash(Number(h));
    const block = await provider.getBlock(hash);
    const input = { height: h, hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs };

    const staged = state.clone();
    staged.applyBlock(input);
    const undo = staged.undoByHeight.get(h)!;
    const events = staged.events.filter((e) => e.blockHeight === h);

    await db.transaction(async (tx) => {
      await store.persistBlock(tx, staged, input, events, undo);
    });
    state.adopt(staged);
    replayed.push(h);
  }

  return { commonAncestor: ancestor, orphaned, replayed, finalRoot: state.stateRoot() };
}

export { hydrateState };
