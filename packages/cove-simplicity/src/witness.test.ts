import { describe, expect, it } from "vitest";
import { applyMintV2, applyRedeemV2, s0StateV2, type CoveStateV2 } from "@crclaunch/cove-covenant";
import {
  atomsToDisplayTokensExact,
  buildMintSimplicityWitness,
  buildRedeemSimplicityWitness,
} from "./witness.js";

const TOKEN = "ab".repeat(32);
const ATOMS = 100_000_000n;
const MINT_AMOUNT = 10_000n * ATOMS;

function s0(): CoveStateV2 {
  return s0StateV2({ tokenId: TOKEN });
}

describe("atomsToDisplayTokensExact (unit-conversion boundaries)", () => {
  it("exact conversion", () => {
    expect(atomsToDisplayTokensExact(ATOMS)).toBe(1n);
    expect(atomsToDisplayTokensExact(10_000n * ATOMS)).toBe(10_000n);
    expect(atomsToDisplayTokensExact(0n)).toBe(0n);
  });
  it("sub-token amount rejected (no truncating division)", () => {
    expect(() => atomsToDisplayTokensExact(ATOMS + 1n)).toThrow(/SUBTOKEN_AMOUNT/);
    expect(() => atomsToDisplayTokensExact(ATOMS - 1n)).toThrow(/SUBTOKEN_AMOUNT/);
  });
  it("negative rejected", () => {
    expect(() => atomsToDisplayTokensExact(-1n)).toThrow(/NEGATIVE_ATOMS/);
  });
});

describe("buildMintSimplicityWitness (canonical, no caller-supplied values)", () => {
  it("derives the witness from the canonical transition", () => {
    const prev = s0();
    const canonical = applyMintV2(prev, MINT_AMOUNT);
    const w = buildMintSimplicityWitness({
      prevState: prev,
      nextState: canonical.nextState,
      amountAtoms: MINT_AMOUNT,
      canonicalGrossSats: canonical.grossSats,
    });
    expect(w.amount).toBe(10_000n);
    expect(w.prevSupply).toBe(0n);
    expect(w.nextSupply).toBe(10_000n);
    expect(w.prevReserve).toBe(0n);
    expect(w.nextReserve).toBe(270n);
    expect(w.contribution).toBe(270n);
  });

  it("rejects a non-canonical successor state", () => {
    const prev = s0();
    const canonical = applyMintV2(prev, MINT_AMOUNT);
    const bogusNext = { ...canonical.nextState, backingSats: 1n };
    expect(() =>
      buildMintSimplicityWitness({
        prevState: prev,
        nextState: bogusNext,
        amountAtoms: MINT_AMOUNT,
        canonicalGrossSats: canonical.grossSats,
      }),
    ).toThrow(/NEXT_STATE_MISMATCH/);
  });

  it("rejects a caller-supplied gross that differs from the canonical R-delta", () => {
    const prev = s0();
    const canonical = applyMintV2(prev, MINT_AMOUNT);
    expect(() =>
      buildMintSimplicityWitness({
        prevState: prev,
        nextState: canonical.nextState,
        amountAtoms: MINT_AMOUNT,
        canonicalGrossSats: canonical.grossSats + 1n,
      }),
    ).toThrow(/GROSS_MISMATCH/);
  });

  it("rejects sub-token amount", () => {
    const prev = s0();
    const canonical = applyMintV2(prev, MINT_AMOUNT);
    expect(() =>
      buildMintSimplicityWitness({
        prevState: prev,
        nextState: canonical.nextState,
        amountAtoms: ATOMS + 1n,
        canonicalGrossSats: canonical.grossSats,
      }),
    ).toThrow(/SUBTOKEN_AMOUNT/);
  });
});

describe("buildRedeemSimplicityWitness (canonical, no caller-supplied values)", () => {
  it("derives the witness from the canonical transition", () => {
    const prev = applyMintV2(s0(), MINT_AMOUNT).nextState;
    const canonical = applyRedeemV2(prev, MINT_AMOUNT);
    const w = buildRedeemSimplicityWitness({
      prevState: prev,
      nextState: canonical.nextState,
      amountAtoms: MINT_AMOUNT,
      canonicalGrossSats: canonical.grossSats,
    });
    expect(w.amount).toBe(10_000n);
    expect(w.oldSupply).toBe(10_000n);
    expect(w.newSupply).toBe(0n);
    expect(w.oldBacking).toBe(270n);
    expect(w.newBacking).toBe(0n);
    expect(w.payout).toBe(270n);
  });

  it("rejects a non-canonical successor state", () => {
    const prev = applyMintV2(s0(), MINT_AMOUNT).nextState;
    const canonical = applyRedeemV2(prev, MINT_AMOUNT);
    const bogusNext = { ...canonical.nextState, backingSats: 1n };
    expect(() =>
      buildRedeemSimplicityWitness({
        prevState: prev,
        nextState: bogusNext,
        amountAtoms: MINT_AMOUNT,
        canonicalGrossSats: canonical.grossSats,
      }),
    ).toThrow(/NEXT_STATE_MISMATCH/);
  });

  it("rejects a caller-supplied payout that differs from the canonical R-delta", () => {
    const prev = applyMintV2(s0(), MINT_AMOUNT).nextState;
    const canonical = applyRedeemV2(prev, MINT_AMOUNT);
    expect(() =>
      buildRedeemSimplicityWitness({
        prevState: prev,
        nextState: canonical.nextState,
        amountAtoms: MINT_AMOUNT,
        canonicalGrossSats: canonical.grossSats - 1n,
      }),
    ).toThrow(/GROSS_MISMATCH/);
  });
});
