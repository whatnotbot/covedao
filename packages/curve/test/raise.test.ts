import { describe, expect, it } from "vitest";
import {
  getTheoreticalFullRaise,
  validateCurveConfig,
  getPublicMintProgress,
  getRemainingPublicSupply,
  PUBLIC_SUPPLY_TOKENS,
  TOTAL_SUPPLY_TOKENS,
  GRADUATION_RESERVE_TOKENS,
  CREATOR_PREMINE_TOKENS,
  TEAM_ALLOCATION_TOKENS,
  STAGE_COUNT,
  STAGE_PRICES_SATS_PER_MILLION,
} from "../src/index.js";

describe("raise economics", () => {
  it("CURVE-005 (golden): full raise = 73,111,500 sats", () => {
    expect(getTheoreticalFullRaise()).toBe(73_111_500n);
  });

  it("reserve contribution before fees is 0.731 BTC", () => {
    const sats = getTheoreticalFullRaise();
    expect(sats).toBe(73_111_500n);
    expect(sats * 100_000_000n / 100_000_000n).toBe(sats);
  });

  it("validateCurveConfig passes for canonical table", () => {
    expect(validateCurveConfig()).toEqual([]);
  });

  it("validateCurveConfig flags each invariant violation", () => {
    const prices = [...STAGE_PRICES_SATS_PER_MILLION];
    expect(validateCurveConfig({ totalSupplyTokens: 20_999_999n })).toContain(
      "TOTAL_SUPPLY_TOKENS must be 21000000.",
    );
    expect(
      validateCurveConfig({ publicSupplyTokens: 20_000_000n, reserveSupplyTokens: 100_000n }),
    ).toContain("public + reserve must equal total supply.");
    expect(validateCurveConfig({ stagePrices: prices.slice(0, 209) })).toContain(
      "Must be exactly 210 stages.",
    );
    const badFirst = [...prices];
    badFirst[0] = 33_001n;
    expect(validateCurveConfig({ stagePrices: badFirst })).toContain("Stage 1 price must be 33000.");
    const badLast = [...prices];
    badLast[209] = 6_929_999n;
    expect(validateCurveConfig({ stagePrices: badLast })).toContain(
      "Stage 210 price must be 6930000.",
    );
    const badOrder = [...prices];
    badOrder[5] = badOrder[4]!;
    expect(validateCurveConfig({ stagePrices: badOrder })).toContain(
      "Stage 6 price must exceed stage 5 price.",
    );
    expect(validateCurveConfig({ tokensPerStage: 99_000n }).join(" ")).toContain(
      "Full raise must be 73111500 sats",
    );
  });

  it("tokenomics are standardized (100% public, zero premine/team/reserve)", () => {
    expect(TOTAL_SUPPLY_TOKENS).toBe(21_000_000n);
    expect(PUBLIC_SUPPLY_TOKENS).toBe(21_000_000n);
    expect(GRADUATION_RESERVE_TOKENS).toBe(0n);
    expect(CREATOR_PREMINE_TOKENS).toBe(0n);
    expect(TEAM_ALLOCATION_TOKENS).toBe(0n);
    expect(PUBLIC_SUPPLY_TOKENS + GRADUATION_RESERVE_TOKENS).toBe(TOTAL_SUPPLY_TOKENS);
    expect(STAGE_COUNT).toBe(210);
  });

  it("getPublicMintProgress computes integer basis points", () => {
    expect(getPublicMintProgress(0n)).toEqual({
      mintedTokens: 0n,
      totalTokens: PUBLIC_SUPPLY_TOKENS,
      bps: 0,
    });
    expect(getPublicMintProgress(PUBLIC_SUPPLY_TOKENS).bps).toBe(10_000);
    expect(getPublicMintProgress(PUBLIC_SUPPLY_TOKENS / 2n).bps).toBe(5_000);
    // 63% example from spec.
    const p = getPublicMintProgress(13_230_000n);
    expect(p.bps).toBe(6_300);
  });

  it("getPublicMintProgress clamps negative supply to zero", () => {
    expect(getPublicMintProgress(-5n).bps).toBe(0);
  });

  it("getPublicMintProgress clamps over-supply to full", () => {
    expect(getPublicMintProgress(PUBLIC_SUPPLY_TOKENS + 1n).bps).toBe(10_000);
  });

  it("getRemainingPublicSupply clamps at zero", () => {
    expect(getRemainingPublicSupply(0n)).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(getRemainingPublicSupply(21_000_000n)).toBe(0n);
    expect(getRemainingPublicSupply(22_000_000n)).toBe(0n);
  });
});
