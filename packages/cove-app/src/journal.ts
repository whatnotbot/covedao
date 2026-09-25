import { eq, and } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import { SIGNING_JOURNAL_TTL_MS, type SigningJournalStore, type SigningReservation } from "@crclaunch/cove-guardian/v3";

/**
 * Postgres-backed durable signing journal (Phase 8 §21). The unique outpoint
 * index (network, backingTxid, backingVout) makes reservation atomic across
 * processes and survives restart — the Guardian can never sign two different
 * successors for the same backing outpoint.
 *
 * A reservation carries a TTL (§C1): an abandoned checkout (build that is never
 * broadcast) self-heals after `SIGNING_JOURNAL_TTL_MS`, and `release` removes a
 * reservation explicitly on session expiry or when signing throws (§C6).
 */
export class PostgresSigningJournal implements SigningJournalStore {
  constructor(readonly db: Database) {}

  private rowKey(params: { network: string; backingTxid: string; backingVout: number }) {
    return and(
      eq(schema.coveV3SigningJournal.network, params.network),
      eq(schema.coveV3SigningJournal.backingTxid, params.backingTxid),
      eq(schema.coveV3SigningJournal.backingVout, params.backingVout),
    );
  }

  async reserve(params: { network: string; backingTxid: string; backingVout: number; unsignedTxDigest: string }): Promise<SigningReservation> {
    const existing = await this.db.select().from(schema.coveV3SigningJournal).where(this.rowKey(params));
    const now = new Date();
    const live = existing[0];
    if (live && live.expiresAt.getTime() > now.getTime()) {
      return live.unsignedTxDigest === params.unsignedTxDigest ? "IDEMPOTENT" : "CONFLICT";
    }
    // Absent or expired: re-reserve. A new digest replaces the expired row (un-brick).
    await this.db
      .delete(schema.coveV3SigningJournal)
      .where(this.rowKey(params));
    const expiresAt = new Date(now.getTime() + SIGNING_JOURNAL_TTL_MS);
    const inserted = await this.db
      .insert(schema.coveV3SigningJournal)
      .values({ network: params.network, backingTxid: params.backingTxid, backingVout: params.backingVout, unsignedTxDigest: params.unsignedTxDigest, expiresAt })
      .onConflictDoNothing()
      .returning({ id: schema.coveV3SigningJournal.id });
    if (inserted.length === 0) {
      const again = await this.db.select().from(schema.coveV3SigningJournal).where(this.rowKey(params));
      return again[0]!.unsignedTxDigest === params.unsignedTxDigest ? "IDEMPOTENT" : "CONFLICT";
    }
    return "RESERVED";
  }

  async committedDigest(network: string, backingTxid: string, backingVout: number): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.coveV3SigningJournal)
      .where(this.rowKey({ network, backingTxid, backingVout }));
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null; // expired → treated as absent
    return row.unsignedTxDigest;
  }

  async release(params: { network: string; backingTxid: string; backingVout: number; unsignedTxDigest: string }): Promise<void> {
    await this.db
      .delete(schema.coveV3SigningJournal)
      .where(and(this.rowKey(params), eq(schema.coveV3SigningJournal.unsignedTxDigest, params.unsignedTxDigest)));
  }
}
