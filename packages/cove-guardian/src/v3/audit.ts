import type { AuditRecord } from "./types.js";

/**
 * Structured audit records (§21). Every Guardian decision — VALID_TO_SIGN or
 * REJECTED — produces a record with no secret material.
 *
 * Operational choice (documented): in this dev/regtest phase, audit persistence
 * is BEST-EFFORT and a logging failure must NOT affect the signing decision
 * (signing cannot be turned into an availability failure of the logger). For
 * mainnet, the preferred semantics is durable-before-sign (fail closed on the
 * inability to persist the record). That is a later, separately-gated change.
 */

export interface AuditSink {
  write(record: AuditRecord): void;
}

function bigintSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(bigintSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = bigintSafe(v);
    return out;
  }
  return value;
}

export const consoleAuditSink: AuditSink = {
  write(record) {
    // Never throws into the signing path; a console failure is swallowed.
    try {
      console.log(`[cove-guardian-audit] ${JSON.stringify(bigintSafe(record))}`);
    } catch {
      /* best-effort audit logging */
    }
  },
};

export function noopAuditSink(): AuditSink {
  return { write: () => {} };
}
