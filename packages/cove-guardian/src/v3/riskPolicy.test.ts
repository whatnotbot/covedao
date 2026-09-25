import { describe, expect, it } from "vitest";
import { s0StateV2 } from "@crclaunch/cove-covenant";
import { checkRiskPolicy, type GuardianRiskPolicy } from "./transitionSigner.js";
import type { MintAnalysis, RedeemAnalysis } from "./types.js";

function policy(overrides: Partial<GuardianRiskPolicy> = {}): GuardianRiskPolicy {
  return {
    maxGrossSats: 200_000n,
    maxMintAtoms: 1_000_000_000n * 100_000_000n,
    minMintGrossSats: 0n,
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
    creatorFeeSats: 20_000n,
    creatorScript: Buffer.from("0014" + "9".repeat(40), "hex"),
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

/**
 * Per-mint bounds. A curve that moves 299x from the first stage to the last
 * makes a token-count limit behave very differently at each end, and the flat
 * fee component makes very small mints uneconomic, so both ends are bounded.
 */
describe("per-mint bounds", () => {
  const base = {
    maxGrossSats: 1_000_000n,
    maxRedeemPayoutSats: 1_000_000n,
    maxBackingSats: 100_000_000_000_000n,
    maxMinerFeeSats: 20_000n,
    allowedTokenIds: [],
    enforceTokenAllowlist: false,
    maxMintAtoms: 2_100_000n * 100_000_000n,
    minMintGrossSats: 5_000n,
  };
  const mint = (amountTokens: bigint, grossSats: bigint) =>
    ({
      tokenId: Buffer.alloc(32, 1),
      amountAtoms: amountTokens * 100_000_000n,
      grossSats,
      minerFeeSats: 1_000n,
      nextState: { backingSats: grossSats },
    }) as never;

  it("accepts a mint inside both bounds", () => {
    expect(checkRiskPolicy(base, mint(2_000_000n, 50_000n), "MINT")).toBeNull();
  });

  it("rejects a mint above the per-mint token limit", () => {
    expect(checkRiskPolicy(base, mint(2_100_001n, 50_000n), "MINT")).toMatch(
      /exceeds the per-mint limit/,
    );
  });

  it("accepts a mint exactly at the limit", () => {
    expect(checkRiskPolicy(base, mint(2_100_000n, 50_000n), "MINT")).toBeNull();
  });

  it("rejects a mint below the minimum value, where the flat fee would dominate", () => {
    expect(checkRiskPolicy(base, mint(1_000n, 4_999n), "MINT")).toMatch(/below the minimum/);
  });

  it("accepts a mint exactly at the minimum value", () => {
    expect(checkRiskPolicy(base, mint(1_000n, 5_000n), "MINT")).toBeNull();
  });

  it("does not apply the mint bounds to a REDEEM", () => {
    expect(checkRiskPolicy(base, mint(9_000_000n, 1n), "REDEEM")).toBeNull();
  });
});
