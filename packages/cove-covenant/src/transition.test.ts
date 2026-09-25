import { describe, expect, it } from "vitest";
import { applyMint, isCorrectMintSuccessor } from "./transition.js";

const S0 = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT" as const,
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

const MINT_50M = 50_000_000n * 100_000_000n;

describe("MINT transition (S0 → S1)", () => {
  it("computes the correct successor state and curve payment", () => {
    const r = applyMint(S0, MINT_50M);
    expect(r.curveContributionSats).toBe(25_000n); // 50M x 500 sats/1M
    expect(r.nextState.publicSupplyAtoms).toBe(MINT_50M);
    expect(r.nextState.reserveSats).toBe(25_000n);
    expect(r.nextState.curveStage).toBe(2);
    expect(r.nextState.phase).toBe("PUBLIC_MINT");
  });

  it("rejects a zero mint", () => {
    expect(() => applyMint(S0, 0n)).toThrow(/positive/);
  });

  it("rejects a sub-token mint", () => {
    expect(() => applyMint(S0, 1n)).toThrow(/whole display token/);
  });

  it("rejects an over-supply mint", () => {
    expect(() => applyMint(S0, 1_000_000_001n * 100_000_000n)).toThrow(/exceed public supply/);
  });

  it("accepts a mint that lands exactly at 1B", () => {
    const r = applyMint(S0, 1_000_000_000n * 100_000_000n);
    expect(r.nextState.publicSupplyAtoms).toBe(1_000_000_000n * 100_000_000n);
    expect(r.curveContributionSats).toBe(28_805_700n); // full raise
  });

  it("recognizes the correct successor and rejects a manipulated one", () => {
    const { nextState } = applyMint(S0, MINT_50M);
    expect(isCorrectMintSuccessor(S0, MINT_50M, nextState)).toBe(true);
    // Manipulated reserve → reject.
    expect(
      isCorrectMintSuccessor(S0, MINT_50M, {
        ...nextState,
        reserveSats: nextState.reserveSats + 1n,
      }),
    ).toBe(false);
    // Manipulated supply → reject.
    expect(
      isCorrectMintSuccessor(S0, MINT_50M, {
        ...nextState,
        publicSupplyAtoms: nextState.publicSupplyAtoms + 1n,
      }),
    ).toBe(false);
  });
});
