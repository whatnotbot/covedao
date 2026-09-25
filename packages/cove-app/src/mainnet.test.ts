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
  guardianXOnly: "12".repeat(32),
  recovery: { threshold: 2, pubkeys: ["15".repeat(32), "77".repeat(32), "88".repeat(32)], csvBlocks: 2016 },
  feeScript: "0014" + "55".repeat(20),
  buyFeeBps: 100,
  redeemFeeBps: 100,
  p2pFeeBps: 50,
  carrierSats: 1000n,
  anchorSats: 10_000n,
  maxProtocolSupplyAtoms: 1_000_000_000n * 100_000_000n,
  reserveAllocationAtoms: 0n,
  mintCmr: "ccdb02000fdb372bfa2e166b9fe0192715d555fc5720f8008ee741fe1a0d58ec",
  redeemCmr: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
  canary: {
    allowedWalletScripts: ["0014" + "66".repeat(20)],
    allowedTokenIds: ["ab".repeat(32)],
    maxBackingSats: 1_000_000_000n,
    maxSingleBuySats: 50_000_000n,
    maxSingleRedeemPayoutSats: 50_000_000n,
    maxP2pSettlementSats: 10_000_000n,
    maxMintAtoms: 2_100_000n * 100_000_000n,
    minMintGrossSats: 5_000n,
  },
};

const healthy: MainnetHealth = {
  primaryCoreHealthy: true,
  secondaryCoreHealthy: true,
  coreAgreement: true,
  indexerHealthy: true,
  stateRootVerified: true,
  workerHealthy: true,
  guardianHealthy: true,
  guardianProfileHashMatches: true,
  guardianKeyMatches: true,
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

  it("requires the SECONDARY Core healthy for CANARY (not just agreement)", () => {
    // §28: secondary=false + coreAgreement=true must NOT become CANARY_READY.
    expect(deriveMainnetStage(completeProfile, false, { ...healthy, secondaryCoreHealthy: false })).toBe("READ_ONLY");
    expect(deriveMainnetStage(completeProfile, true, { ...healthy, secondaryCoreHealthy: false })).toBe("READ_ONLY");
    expect(deriveMainnetStage(completeProfile, true, { ...healthy, coreAgreement: false })).toBe("READ_ONLY");
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
    expect(missing).toContain("OWNER_DECISION_REQUIRED: activationHeight");
    expect(missing).toContain("OWNER_DECISION_REQUIRED: guardianXOnly");
    expect(missing).toContain("OWNER_DECISION_REQUIRED: feeScript");
    expect(missingOwnerDecisions(completeProfile)).toEqual([]);
  });
});
