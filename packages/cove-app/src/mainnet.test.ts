import { describe, expect, it } from "vitest";
import {
  deriveMainnetStage,
  mainnetProfileComplete,
  missingOwnerDecisions,
  assertNoLocalGuardianKeyOnMainnet,
  assertNoRecoveryPrivateKeyOnMainnet,
  type MainnetProfile,
  type MainnetHealth,
} from "./mainnet.js";

const completeProfile: MainnetProfile = {
  profileVersion: 1,
  chainIdentity: "bitcoin-mainnet",
  activationHeight: 900_000n,
  policyVersion: 3,
  vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
  guardianXOnly: "11".repeat(32),
  recovery: { threshold: 2, pubkeys: ["21".repeat(32), "31".repeat(32), "41".repeat(32)], csvBlocks: 2016 },
  feeScript: "0014" + "55".repeat(20),
  buyFeeBps: 100n,
  redeemFeeBps: 100n,
  p2pFeeBps: 50n,
  carrierSats: 1000n,
  anchorSats: 10_000n,
  maxProtocolSupply: 1_000_000_000n * 100_000_000n,
  reserveAllocation: 160_000_000n * 100_000_000n,
  mintCmr: "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377",
  redeemCmr: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
};

const healthy: MainnetHealth = {
  primaryCoreHealthy: true,
  secondaryCoreHealthy: true,
  coreAgreement: true,
  indexerHealthy: true,
  stateRootVerified: true,
  workerHealthy: true,
  guardianHealthy: true,
  auditHealthy: true,
  signingJournalHealthy: true,
  profileHashMatches: true,
};

describe("mainnet activation stages (§27/§28)", () => {
  it("defaults to DISABLED with an incomplete profile", () => {
    const p = { ...completeProfile, activationHeight: null, guardianXOnly: null, feeScript: null, buyFeeBps: null, redeemFeeBps: null, p2pFeeBps: null };
    expect(mainnetProfileComplete(p)).toBe(false);
    expect(deriveMainnetStage(p, false, healthy)).toBe("DISABLED");
  });

  it("requires profile completeness + health before CANARY_ACTIVE", () => {
    expect(deriveMainnetStage(completeProfile, true, healthy)).toBe("CANARY_ACTIVE");
    expect(deriveMainnetStage(completeProfile, false, healthy)).toBe("CANARY_READY");
    expect(deriveMainnetStage(completeProfile, true, { ...healthy, profileHashMatches: false })).toBe("DISABLED");
    expect(deriveMainnetStage(completeProfile, true, { ...healthy, primaryCoreHealthy: false })).toBe("READ_ONLY");
  });

  it("rejects local Guardian / recovery keys on mainnet", () => {
    expect(() => assertNoLocalGuardianKeyOnMainnet("mainnet", Buffer.alloc(32, 1))).toThrow(/local Guardian key/);
    expect(() => assertNoLocalGuardianKeyOnMainnet("regtest", Buffer.alloc(32, 1))).not.toThrow();
    expect(() => assertNoRecoveryPrivateKeyOnMainnet("mainnet", Buffer.alloc(32, 1))).toThrow(/recovery private keys/);
    expect(() => assertNoRecoveryPrivateKeyOnMainnet("regtest", Buffer.alloc(32, 1))).not.toThrow();
  });

  it("reports OWNER_DECISION_REQUIRED keys", () => {
    const p = { ...completeProfile, activationHeight: null, guardianXOnly: null, feeScript: null };
    const missing = missingOwnerDecisions(p);
    expect(missing).toContain("activationHeight");
    expect(missing).toContain("guardianXOnly");
    expect(missing).toContain("feeScript");
    expect(missingOwnerDecisions(completeProfile)).toEqual([]);
  });
});
