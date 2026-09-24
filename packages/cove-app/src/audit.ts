import { eq, desc } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import {
  computeGuardianAuditHash,
  type GuardianAuditDigestFields,
  type DurableAuditSink,
  type AuditRecord,
} from "@crclaunch/cove-guardian/v3";

/**
 * Postgres durable-before-sign Guardian audit store (§17/§19/§20). Persists a
 * VALIDATED_TO_SIGN record BEFORE any signature and returns its hash-chain
 * hash; writeAfterSign marks it signed. Audit persistence failure throws, which
 * the LocalGuardianTransitionSigner maps to AUDIT_PERSISTENCE_FAILED (no
 * signature).
 */

function digestFields(r: AuditRecord): GuardianAuditDigestFields {
  return {
    requestId: r.requestId,
    operation: r.operation,
    tokenId: r.tokenId,
    backingTxid: r.backingOutpoint.txid,
    backingVout: r.backingOutpoint.vout,
    prevStateHash: r.prevStateHash,
    nextStateHash: r.nextStateHash,
    amountAtoms: r.amountAtoms,
    grossSats: r.grossSats,
    protocolFeeSats: r.protocolFeeSats,
    minerFeeSats: r.minerFeeSats,
    expectedCmr: r.expectedCmr,
    actualCmr: r.actualCmr,
    unsignedTxDigest: r.unsignedTxDigest,
    decision: r.decision,
    rejectionReason: r.rejectionReason,
  };
}

export class PostgresGuardianAudit implements DurableAuditSink {
  constructor(readonly db: Database, readonly vaultProfileVersion: string = "COVE_V3_VAULT_PROFILE_DEV1") {}

  private async headHash(network: string): Promise<string> {
    const rows = await this.db
      .select({ auditHash: schema.coveV3GuardianAudit.auditHash })
      .from(schema.coveV3GuardianAudit)
      .where(eq(schema.coveV3GuardianAudit.network, network))
      .orderBy(desc(schema.coveV3GuardianAudit.beforeSignPersistedAt))
      .limit(1);
    return rows[0]?.auditHash ?? "0".repeat(64);
  }

  async writeBeforeSign(record: AuditRecord): Promise<{ auditHash: string }> {
    const previousAuditHash = await this.headHash(record.network);
    const auditHash = computeGuardianAuditHash(previousAuditHash, digestFields(record));
    await this.db.insert(schema.coveV3GuardianAudit).values({
      network: record.network,
      requestId: record.requestId,
      operation: record.operation,
      tokenId: record.tokenId,
      backingTxid: record.backingOutpoint.txid,
      backingVout: record.backingOutpoint.vout,
      prevStateHash: record.prevStateHash,
      nextStateHash: record.nextStateHash,
      amountAtoms: record.amountAtoms,
      grossSats: record.grossSats,
      protocolFeeSats: record.protocolFeeSats,
      minerFeeSats: record.minerFeeSats,
      policyVersion: record.policyVersion,
      vaultProfileVersion: this.vaultProfileVersion,
      expectedCmr: record.expectedCmr,
      actualCmr: record.actualCmr,
      simplicityResult: record.simplicityResult,
      referencePolicyResult: record.referencePolicyResult,
      unsignedTxDigest: record.unsignedTxDigest,
      decision: record.decision,
      rejectionReason: record.rejectionReason,
      beforeSignPersistedAt: new Date(),
      previousAuditHash,
      auditHash,
    });
    return { auditHash };
  }

  async writeAfterSign(record: AuditRecord, _auditHash: string): Promise<void> {
    await this.db
      .update(schema.coveV3GuardianAudit)
      .set({ signedAt: new Date() })
      .where(eq(schema.coveV3GuardianAudit.requestId, record.requestId));
  }
}
