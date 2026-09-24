import { describe, expect, it } from "vitest";
import {
  computeGuardianAuditHash,
  canonicalAuditRecordBytes,
  InMemorySigningJournal,
  type GuardianAuditDigestFields,
} from "./journal.js";

function fields(overrides: Partial<GuardianAuditDigestFields> = {}): GuardianAuditDigestFields {
  return {
    requestId: "req-1",
    operation: "MINT",
    tokenId: "aa".repeat(32),
    backingTxid: "bb".repeat(32),
    backingVout: 1,
    prevStateHash: "cc".repeat(32),
    nextStateHash: "dd".repeat(32),
    amountAtoms: 42_000_000n * 100_000_000n,
    grossSats: 49_350n,
    protocolFeeSats: 494n,
    minerFeeSats: 1_000n,
    expectedCmr: "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377",
    actualCmr: "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377",
    unsignedTxDigest: "ee".repeat(32),
    decision: "VALID_TO_SIGN",
    rejectionReason: null,
    ...overrides,
  };
}

describe("Guardian durable audit + signing journal (§17-§23)", () => {
  it("audit hash is deterministic and endian-frozen (no property order)", () => {
    const f = fields();
    const a = computeGuardianAuditHash("0".repeat(64), f);
    const b = computeGuardianAuditHash("0".repeat(64), { ...f });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    // Any field mutation changes the hash.
    expect(computeGuardianAuditHash("0".repeat(64), fields({ amountAtoms: 1n }))).not.toBe(a);
    expect(canonicalAuditRecordBytes(f).equals(canonicalAuditRecordBytes({ ...f }))).toBe(true);
  });

  it("hash chain links previous audit hash", () => {
    const f1 = fields();
    const h1 = computeGuardianAuditHash("0".repeat(64), f1);
    const f2 = fields({ requestId: "req-2" });
    const h2 = computeGuardianAuditHash(h1, f2);
    expect(h2).not.toBe(h1);
    expect(h2).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signing journal: first digest wins; conflicting digest is rejected; same digest idempotent", async () => {
    const j = new InMemorySigningJournal();
    const outpoint = { network: "regtest", backingTxid: "bb".repeat(32), backingVout: 1 };
    expect(await j.reserve({ ...outpoint, unsignedTxDigest: "11".repeat(32) })).toBe("RESERVED");
    expect(await j.reserve({ ...outpoint, unsignedTxDigest: "22".repeat(32) })).toBe("CONFLICT");
    expect(await j.reserve({ ...outpoint, unsignedTxDigest: "11".repeat(32) })).toBe("IDEMPOTENT");
    expect(await j.committedDigest(outpoint.network, outpoint.backingTxid, outpoint.backingVout)).toBe("11".repeat(32));
  });

  it("signing journal: 20 concurrent distinct digests → exactly one RESERVED, 19 CONFLICT", async () => {
    const j = new InMemorySigningJournal();
    const outpoint = { network: "regtest", backingTxid: "cc".repeat(32), backingVout: 3 };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => j.reserve({ ...outpoint, unsignedTxDigest: i.toString(16).padStart(64, "0") })),
    );
    expect(results.filter((r) => r === "RESERVED")).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(19);
  });
});
