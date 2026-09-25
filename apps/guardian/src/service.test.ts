import { describe, expect, it } from "vitest";
import type { MainnetProfile } from "@crclaunch/cove-mainnet";
import { riskPolicyFromProfile } from "./service.js";

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
    maxBackingSats: 1_000_000n,
    maxSingleBuySats: 200_000n,
    maxSingleRedeemPayoutSats: 200_000n,
    maxP2pSettlementSats: 200_000n,
  },
};

describe("riskPolicyFromProfile (P0-2/P0-4)", () => {
  it("builds the policy from the committed profile caps, not env", () => {
    const p = riskPolicyFromProfile(profile);
    expect(p.maxGrossSats).toBe(200_000n); // maxSingleBuySats
    expect(p.maxRedeemPayoutSats).toBe(200_000n); // maxSingleRedeemPayoutSats
    expect(p.maxBackingSats).toBe(1_000_000n); // maxBackingSats
    expect(p.allowedTokenIds).toEqual(["ab".repeat(32)]);
    expect(p.enforceTokenAllowlist).toBe(true);
    expect(p.maxMinerFeeSats).toBe(20_000n); // fixed operational cap
  });

  it("fails closed: an empty allowlist yields a policy that rejects every token", () => {
    const p = riskPolicyFromProfile({ ...profile, canary: { ...profile.canary, allowedTokenIds: [] } });
    expect(p.enforceTokenAllowlist).toBe(true);
    expect(p.allowedTokenIds).toEqual([]);
  });
});
