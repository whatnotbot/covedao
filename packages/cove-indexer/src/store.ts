import { createDb, schema, type Database } from "@crclaunch/db";
import type { CoveState } from "@crclaunch/protocol";
import { eq } from "drizzle-orm";
import type { CoveIndexEvent } from "./indexer.js";

/**
 * Persistent Cove V1 store (Postgres via the existing drizzle schema).
 * The pure CoveIndexer is the source of truth for state; this store projects
 * blocks / operations / tokens / balances / checkpoint / cursor so the indexer
 * is restart-safe and reorg-auditable.
 */
export class CoveStore {
  readonly db: Database;
  constructor(databaseUrl: string) {
    this.db = createDb(databaseUrl);
  }

  async saveBlock(network: string, height: number, hash: string, parentHash: string): Promise<void> {
    await this.db
      .insert(schema.coveBlocks)
      .values({ network, height: BigInt(height), hash, parentHash })
      .onConflictDoUpdate({
        target: [schema.coveBlocks.network, schema.coveBlocks.height],
        set: { hash, parentHash, canonical: true },
      });
  }

  async saveOperations(network: string, events: readonly CoveIndexEvent[]): Promise<void> {
    for (const e of events) {
      await this.db
        .insert(schema.coveOperations)
        .values({
          network,
          txid: e.txid,
          blockHeight: BigInt(e.blockHeight),
          txIndex: e.txIndex,
          operation: e.operation,
          classification: e.classification,
          valid: e.valid,
          reason: e.reason,
        })
        .onConflictDoUpdate({
          target: [schema.coveOperations.network, schema.coveOperations.txid],
          set: { blockHeight: BigInt(e.blockHeight), txIndex: e.txIndex, valid: e.valid, reason: e.reason },
        });
    }
  }

  async saveState(
    network: string,
    state: CoveState,
    height: number,
    blockHash: string,
    stateRoot: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // tokens
      for (const [deploymentId, t] of state.tokens) {
        await tx
          .insert(schema.coveTokens)
          .values({
            network,
            deploymentId,
            ticker: t.ticker,
            creator: t.creator,
            confirmedSupplyAtoms: t.confirmedSupplyAtoms,
            currentStage: t.currentStage,
          })
          .onConflictDoUpdate({
            target: [schema.coveTokens.network, schema.coveTokens.deploymentId],
            set: { confirmedSupplyAtoms: t.confirmedSupplyAtoms, currentStage: t.currentStage },
          });
      }
      // balances
      for (const [owner, m] of state.balances) {
        for (const [deploymentId, b] of m) {
          await tx
            .insert(schema.coveBalances)
            .values({
              network,
              ownerScript: owner,
              deploymentId,
              availableAtoms: b.availableAtoms,
              lockedAtoms: 0n,
            })
            .onConflictDoUpdate({
              target: [schema.coveBalances.network, schema.coveBalances.ownerScript, schema.coveBalances.deploymentId],
              set: { availableAtoms: b.availableAtoms, lockedAtoms: 0n },
            });
        }
      }
      // checkpoint + cursor
      await tx
        .insert(schema.coveCheckpoints)
        .values({ network, height: BigInt(height), blockHash, stateRoot })
        .onConflictDoUpdate({
          target: [schema.coveCheckpoints.network, schema.coveCheckpoints.height],
          set: { blockHash, stateRoot },
        });
      await tx
        .insert(schema.coveCursor)
        .values({ network, height: BigInt(height), blockHash })
        .onConflictDoUpdate({
          target: [schema.coveCursor.network],
          set: { height: BigInt(height), blockHash },
        });
    });
  }

  async getCursor(network: string): Promise<{ height: bigint; blockHash: string } | undefined> {
    const rows = await this.db
      .select()
      .from(schema.coveCursor)
      .where(eq(schema.coveCursor.network, network))
      .execute();
    return rows[0] ? { height: rows[0].height, blockHash: rows[0].blockHash } : undefined;
  }

  async getLatestCheckpoint(network: string): Promise<{ height: bigint; blockHash: string; stateRoot: string } | undefined> {
    const rows = await this.db
      .select()
      .from(schema.coveCheckpoints)
      .where(eq(schema.coveCheckpoints.network, network))
      .orderBy(schema.coveCheckpoints.height)
      .execute();
    const last = rows.at(-1);
    return last ? { height: last.height, blockHash: last.blockHash, stateRoot: last.stateRoot } : undefined;
  }

  async clearCove(network: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.coveBlocks).where(eq(schema.coveBlocks.network, network));
      await tx.delete(schema.coveOperations).where(eq(schema.coveOperations.network, network));
      await tx.delete(schema.coveTokens).where(eq(schema.coveTokens.network, network));
      await tx.delete(schema.coveBalances).where(eq(schema.coveBalances.network, network));
      await tx.delete(schema.coveCheckpoints).where(eq(schema.coveCheckpoints.network, network));
      await tx.delete(schema.coveCursor).where(eq(schema.coveCursor.network, network));
    });
  }
}
