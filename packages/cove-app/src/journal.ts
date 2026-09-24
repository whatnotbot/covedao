import { eq, and } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import type { SigningJournalStore, SigningReservation } from "@crclaunch/cove-guardian/v3";

/**
 * Postgres-backed durable signing journal (Phase 8 §21). The unique outpoint
 * index (network, backingTxid, backingVout) makes reservation atomic across
 * processes and survives restart — the Guardian can never sign two different
 * successors for the same backing outpoint.
 */
export class PostgresSigningJournal implements SigningJournalStore {
  constructor(readonly db: Database) {}
  async reserve(params: { network: string; backingTxid: string; backingVout: number; unsignedTxDigest: string }): Promise<SigningReservation> {
    const existing = await this.db
      .select()
      .from(schema.coveV3SigningJournal)
      .where(
        and(
          eq(schema.coveV3SigningJournal.network, params.network),
          eq(schema.coveV3SigningJournal.backingTxid, params.backingTxid),
          eq(schema.coveV3SigningJournal.backingVout, params.backingVout),
        ),
      );
    if (existing.length > 0) {
      return existing[0]!.unsignedTxDigest === params.unsignedTxDigest ? "IDEMPOTENT" : "CONFLICT";
    }
    const inserted = await this.db
      .insert(schema.coveV3SigningJournal)
      .values({ network: params.network, backingTxid: params.backingTxid, backingVout: params.backingVout, unsignedTxDigest: params.unsignedTxDigest })
      .onConflictDoNothing()
      .returning({ id: schema.coveV3SigningJournal.id });
    if (inserted.length === 0) {
      const again = await this.db
        .select()
        .from(schema.coveV3SigningJournal)
        .where(
          and(
            eq(schema.coveV3SigningJournal.network, params.network),
            eq(schema.coveV3SigningJournal.backingTxid, params.backingTxid),
            eq(schema.coveV3SigningJournal.backingVout, params.backingVout),
          ),
        );
      return again[0]!.unsignedTxDigest === params.unsignedTxDigest ? "IDEMPOTENT" : "CONFLICT";
    }
    return "RESERVED";
  }
  async committedDigest(network: string, backingTxid: string, backingVout: number): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.coveV3SigningJournal)
      .where(
        and(
          eq(schema.coveV3SigningJournal.network, network),
          eq(schema.coveV3SigningJournal.backingTxid, backingTxid),
          eq(schema.coveV3SigningJournal.backingVout, backingVout),
        ),
      );
    return rows[0]?.unsignedTxDigest ?? null;
  }
}
