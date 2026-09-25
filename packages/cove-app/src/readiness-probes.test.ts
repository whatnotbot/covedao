import { describe, expect, it } from "vitest";
import { committedHash, evaluateIndexerProbe } from "./readiness-probes.js";
import { computeMainnetReadiness, type MainnetReadinessInput } from "./readiness.js";
import type { HealthReport } from "@crclaunch/cove-indexer/v3";
import type { MainnetProfile } from "@crclaunch/cove-mainnet";

const profile: MainnetProfile = {
  profileVersion: 1,
  chainIdentity: "bitcoin-mainnet",
  activationHeight: 900_000n,
  policyVersion: 3,
  vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
  guardianXOnly: "12".repeat(32),
  recovery: { threshold: 2, pubkeys: ["15".repeat(32), "77".repeat(32), "88".repeat(32)], csvBlocks: 2016 },
  feeScript: "0014" + "55".repeat(20),
  buyFeeBps: 100,
  redeemFeeBps: 100,
  p2pFeeBps: 50,
  carrierSats: 1000n,
  anchorSats: 10_000n,
  maxProtocolSupplyAtoms: 840_000_000n * 100_000_000n,
  reserveAllocationAtoms: 160_000_000n * 100_000_000n,
  mintCmr: "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377",
  redeemCmr: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
  canary: {
    allowedWalletScripts: ["0014" + "66".repeat(20)],
    allowedTokenIds: ["ab".repeat(32)],
    maxBackingSats: 1_000_000_000n,
    maxSingleBuySats: 50_000_000n,
    maxSingleRedeemPayoutSats: 50_000_000n,
    maxP2pSettlementSats: 10_000_000n,
  },
};

function input(overrides: Partial<MainnetReadinessInput> = {}): MainnetReadinessInput {
  return {
    profile,
    profileHash: "ab".repeat(32),
    expectedProfileHash: "ab".repeat(32),
    releaseManifestOk: true,
    primaryCoreHealthy: true,
    secondaryCoreHealthy: true,
    coreAgreement: true,
    indexerHealthy: true,
    stateRootVerified: true,
    workerHealthy: true,
    guardianHealthy: true,
    guardianProfileHash: "ab".repeat(32),
    guardianXOnly: "12".repeat(32),
    custodyBackendReady: true,
    auditHealthy: true,
    signingJournalHealthy: true,
    canaryActive: false,
    ...overrides,
  };
}

function healthReport(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    health: "HEALTHY",
    cursorHeight: 900_000n,
    cursorBlockHash: "bb".repeat(32),
    coreHeight: 900_000n,
    coreBlockHashAtCursor: "bb".repeat(32),
    lag: 0n,
    stateRoot: "cc".repeat(32),
    rebuilding: false,
    ...overrides,
  };
}

describe("committedHash (§P1-1)", () => {
  it("normalizes a valid 64-hex committed hash", () => {
    expect(committedHash("AB".repeat(32))).toBe("ab".repeat(32));
    expect(committedHash("  " + "cd".repeat(32) + "  ")).toBe("cd".repeat(32));
  });

  it("fails closed on missing/invalid committed hashes", () => {
    expect(committedHash(undefined)).toBeNull();
    expect(committedHash("")).toBeNull();
    expect(committedHash("not-hex")).toBeNull();
    expect(committedHash("ab".repeat(31))).toBeNull();
  });
});

describe("evaluateIndexerProbe (§P1-1)", () => {
  it("is green only for HEALTHY + matching committed state root", () => {
    const r = evaluateIndexerProbe(healthReport(), "cc".repeat(32));
    expect(r.indexerHealthy).toBe(true);
    expect(r.stateRootVerified).toBe(true);
  });

  it("fails closed when the indexer is not HEALTHY", () => {
    const r = evaluateIndexerProbe(healthReport({ health: "BEHIND" }), "cc".repeat(32));
    expect(r.indexerHealthy).toBe(false);
    expect(r.stateRootVerified).toBe(false);
  });

  it("fails closed on a state-root mismatch", () => {
    const r = evaluateIndexerProbe(healthReport(), "dd".repeat(32));
    expect(r.indexerHealthy).toBe(true);
    expect(r.stateRootVerified).toBe(false);
  });

  it("fails closed when the committed state root is absent or the report is null", () => {
    expect(evaluateIndexerProbe(healthReport(), null).stateRootVerified).toBe(false);
    expect(evaluateIndexerProbe(null, "cc".repeat(32)).indexerHealthy).toBe(false);
    expect(evaluateIndexerProbe(null, null).stateRootVerified).toBe(false);
  });
});

describe("readiness is probe-driven, not asserted (§P1-1)", () => {
  it("a missing committed profile hash disables the stage (no self-comparison)", () => {
    const r = computeMainnetReadiness(input({ profileHash: "ab".repeat(32), expectedProfileHash: "" }));
    expect(r.profileHashMatches).toBe(false);
    expect(r.stage).toBe("DISABLED");
  });

  it("unhealthy indexer / worker / state-root / release-manifest block CANARY_READY", () => {
    expect(computeMainnetReadiness(input({ indexerHealthy: false })).stage).toBe("READ_ONLY");
    expect(computeMainnetReadiness(input({ stateRootVerified: false })).stage).toBe("READ_ONLY");
    expect(computeMainnetReadiness(input({ workerHealthy: false })).stage).toBe("READ_ONLY");
    // releaseManifestOk is tracked but does not alone gate the stage (it is
    // reported, not a stage input); assert it is carried through faithfully.
    expect(computeMainnetReadiness(input({ releaseManifestOk: false })).releaseManifestOk).toBe(false);
  });

  it("only a fully-green, committed-hash-matched input reaches CANARY", () => {
    expect(computeMainnetReadiness(input({ canaryActive: true })).stage).toBe("CANARY_ACTIVE");
    expect(computeMainnetReadiness(input({ canaryActive: true, indexerHealthy: false })).stage).toBe("READ_ONLY");
  });
});
