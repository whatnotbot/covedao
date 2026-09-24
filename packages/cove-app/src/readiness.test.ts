import { describe, expect, it } from "vitest";
import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import type { MainnetProfile } from "@crclaunch/cove-mainnet";
import { checkCoreAgreement, computeMainnetReadiness, deriveReadinessState, type MainnetReadinessInput } from "./readiness.js";

function mockCore(chain: string, blocks: number, hashes: Map<number, string>): CoreRpcProvider {
  return {
    getBlockchainInfo: async () => ({ chain, blocks, bestBlockHash: hashes.get(blocks) ?? "h".repeat(64) }),
    getBlockHash: async (height: number) => hashes.get(height) ?? `hash-${height}`,
  } as unknown as CoreRpcProvider;
}

const profile: MainnetProfile = {
  profileVersion: 1,
  chainIdentity: "bitcoin-mainnet",
  activationHeight: 900_000n,
  policyVersion: 3,
  vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
  guardianXOnly: "11".repeat(32),
  recovery: { threshold: 2, pubkeys: ["21".repeat(32), "31".repeat(32), "41".repeat(32)], csvBlocks: 2016 },
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

function readyInput(overrides: Partial<MainnetReadinessInput> = {}): MainnetReadinessInput {
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
    guardianXOnly: "11".repeat(32),
    custodyBackendReady: true,
    auditHealthy: true,
    signingJournalHealthy: true,
    canaryActive: false,
    ...overrides,
  };
}

describe("core quorum + readiness aggregator (§27-§30)", () => {
  it("checkCoreAgreement agrees when heights + hashes match", async () => {
    const hashes = new Map([[100, "h100"], [0, "g0"]]);
    const a = mockCore("regtest", 100, hashes);
    const b = mockCore("regtest", 100, hashes);
    const r = await checkCoreAgreement(a, b);
    expect(r.agreed).toBe(true);
    expect(r.comparisonHeight).toBe(100);
  });

  it("checkCoreAgreement disagrees on hash mismatch", async () => {
    const a = mockCore("regtest", 100, new Map([[100, "h100"]]));
    const b = mockCore("regtest", 100, new Map([[100, "h999"]]));
    const r = await checkCoreAgreement(a, b);
    expect(r.agreed).toBe(false);
    expect(r.detail).toContain("hash mismatch");
  });

  it("checkCoreAgreement disagrees on chain mismatch", async () => {
    const a = mockCore("main", 100, new Map());
    const b = mockCore("test", 100, new Map());
    const r = await checkCoreAgreement(a, b);
    expect(r.agreed).toBe(false);
    expect(r.detail).toContain("chain mismatch");
  });

  it("readiness requires EVERY runtime health signal before CANARY", () => {
    expect(computeMainnetReadiness(readyInput({ canaryActive: true })).stage).toBe("CANARY_ACTIVE");
    expect(computeMainnetReadiness(readyInput({ canaryActive: false })).stage).toBe("CANARY_READY");
    // §28: secondary down + agreement true must NOT be CANARY_READY.
    expect(computeMainnetReadiness(readyInput({ secondaryCoreHealthy: false })).stage).toBe("READ_ONLY");
    expect(computeMainnetReadiness(readyInput({ guardianProfileHash: "00".repeat(32) })).stage).toBe("READ_ONLY");
    expect(computeMainnetReadiness(readyInput({ guardianXOnly: "00".repeat(32) })).stage).toBe("READ_ONLY");
    expect(computeMainnetReadiness(readyInput({ profileHash: "00".repeat(32) })).stage).toBe("DISABLED");
  });

  it("mutations are only enabled at CANARY_ACTIVE", () => {
    expect(computeMainnetReadiness(readyInput({ canaryActive: true })).mutationsEnabled).toBe(true);
    expect(computeMainnetReadiness(readyInput({ canaryActive: false })).mutationsEnabled).toBe(false);
  });

  it("derives the top-level readiness state (§9/§50)", () => {
    expect(deriveReadinessState(computeMainnetReadiness(readyInput({ canaryActive: false })))).toBe("READY_FOR_CONTROLLED_MAINNET_CANARY");
    // incomplete profile (missing a canary cap) => READY_EXCEPT_FOR_OPERATOR_CEREMONY
    const incomplete = { ...profile, canary: { ...profile.canary, maxBackingSats: null } };
    expect(deriveReadinessState(computeMainnetReadiness(readyInput({ profile: incomplete })))).toBe("READY_EXCEPT_FOR_OPERATOR_CEREMONY");
    // complete profile but secondary Core down => NOT_READY
    expect(deriveReadinessState(computeMainnetReadiness(readyInput({ secondaryCoreHealthy: false })))).toBe("NOT_READY");
  });
});
