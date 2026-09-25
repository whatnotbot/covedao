import { describe, expect, it } from "vitest";
import { s0StateV2 } from "@crclaunch/cove-covenant";
import { checkRiskPolicy, type GuardianRiskPolicy } from "./transitionSigner.js";
import type { MintAnalysis, RedeemAnalysis } from "./types.js";

function policy(overrides: Partial<GuardianRiskPolicy> = {}): GuardianRiskPolicy {
  return {
    maxGrossSats: 200_000n,
    maxRedeemPayoutSats: 200_000n,
    maxBackingSats: 1_000_000n,
    maxMinerFeeSats: 20_000n,
    allowedTokenIds: ["ab".repeat(32)],
    enforceTokenAllowlist: true,
    ...overrides,
  };
}

const TOKEN = "ab".repeat(32);

function mintAnalysis(overrides: Partial<MintAnalysis> = {}): MintAnalysis {
  return {
    op: "MINT",
    tokenId: Buffer.from(TOKEN, "hex"),
    amountAtoms: 1_000_000n,
    recipientVout: 2,
    currentState: s0StateV2({ tokenId: TOKEN }),
    backingOutpoint: { txid: "c".repeat(64), vout: 0 },
    nextState: s0StateV2({ tokenId: TOKEN }),
    grossSats: 100_000n,
    protocolFeeSats: 1_000n,
    minerFeeSats: 1_000n,
    backingInputIndex: 0,
    buyerInputIndices: [1],
    ...overrides,
  };
}

function redeemAnalysis(overrides: Partial<RedeemAnalysis> = {}): RedeemAnalysis {
  return {
    op: "REDEEM",
    tokenId: Buffer.from(TOKEN, "hex"),
    redeemAmountAtoms: 1_000_000n,
    changeAllocations: [],
    currentState: s0StateV2({ tokenId: TOKEN }),
    backingOutpoint: { txid: "c".repeat(64), vout: 0 },
    tokenInputOutpoints: [],
    tokenInputTotalAtoms: 1_000_000n,
    nextState: s0StateV2({ tokenId: TOKEN }),
    grossSats: 100_000n,
    protocolFeeSats: 1_000n,
    netPayoutSats: 99_000n,
    minerFeeSats: 1_000n,
    backingInputIndex: 0,
    tokenInputIndices: [1],
    ...overrides,
  };
}

describe("checkRiskPolicy (P0-3/P0-4)", () => {
  it("rejects EVERY token when the allowlist is empty (nobody)", () => {
    const p = policy({ allowedTokenIds: [], enforceTokenAllowlist: true });
    expect(checkRiskPolicy(p, mintAnalysis(), "MINT")).toContain("allowlist");
  });

  it("rejects a token not in the allowlist", () => {
    const p = policy({ allowedTokenIds: ["00".repeat(32)], enforceTokenAllowlist: true });
    expect(checkRiskPolicy(p, mintAnalysis(), "MINT")).toContain("allowlist");
  });

  it("allows a token in the allowlist", () => {
    expect(checkRiskPolicy(policy(), mintAnalysis(), "MINT")).toBeNull();
  });

  it("does not enforce the allowlist when enforceTokenAllowlist=false (regtest/dev)", () => {
    const p = policy({ allowedTokenIds: [], enforceTokenAllowlist: false });
    expect(checkRiskPolicy(p, mintAnalysis(), "MINT")).toBeNull();
  });

  it("rejects a buy gross above maxGrossSats (= maxSingleBuySats)", () => {
    const p = policy({ maxGrossSats: 200_000n });
    expect(checkRiskPolicy(p, mintAnalysis({ grossSats: 200_001n }), "MINT")).toContain("gross");
  });

  it("rejects a redeem payout above maxRedeemPayoutSats (= maxSingleRedeemPayoutSats)", () => {
    const p = policy({ maxRedeemPayoutSats: 200_000n });
    expect(checkRiskPolicy(p, redeemAnalysis({ netPayoutSats: 200_001n }), "REDEEM")).toContain("redeem payout");
  });
});
