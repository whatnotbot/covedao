import { describe, expect, it } from "vitest";
import { ATOMS_PER_TOKEN } from "@crclaunch/curve";
import { requiredBackingSats } from "@crclaunch/cove-economics";
import { applyMint, applyRedeem, CovenantError } from "./transition.js";
import type { CoveState } from "./types.js";

const S0: CoveState = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT",
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

/** One stair: 100,000 tokens. */
const MINT_50M = 100_000n * ATOMS_PER_TOKEN;

describe("canonical curve unification (§1.2) + applyRedeem", () => {
  it("applyMint contribution == R-delta == grossBuy", () => {
    const r = applyMint(S0, MINT_50M);
    expect(r.curveContributionSats).toBe(869_200n);
    // backing invariant: state.reserveSats == R(issuedSupply in tokens)
    const supplyTokens = r.nextState.publicSupplyAtoms / ATOMS_PER_TOKEN;
    expect(r.nextState.reserveSats).toBe(requiredBackingSats(supplyTokens));
  });

  it("applyRedeem: mint then redeem returns to S0 (reserve 0)", () => {
    const mint = applyMint(S0, MINT_50M);
    const redeem = applyRedeem(mint.nextState, MINT_50M);
    expect(redeem.grossRedeemSats).toBe(869_200n);
    expect(redeem.nextState.publicSupplyAtoms).toBe(0n);
    expect(redeem.nextState.reserveSats).toBe(0n);
    expect(redeem.nextState.curveStage).toBe(1);
  });

  it("applyRedeem releases capacity for re-buy", () => {
    const mint = applyMint(S0, MINT_50M);
    const redeem = applyRedeem(mint.nextState, MINT_50M);
    const rebuy = applyMint(redeem.nextState, MINT_50M);
    expect(rebuy.nextState.publicSupplyAtoms).toBe(mint.nextState.publicSupplyAtoms);
    expect(rebuy.curveContributionSats).toBe(mint.curveContributionSats);
  });

  it("applyRedeem rejects zero / sub-token / over-balance", () => {
    expect(() => applyRedeem(S0, 0n)).toThrow(CovenantError);
    expect(() => applyRedeem(S0, 1n)).toThrow(CovenantError); // sub-token
    expect(() => applyRedeem(S0, MINT_50M)).toThrow(/issued/i);
  });

  it("state.backing == R(issuedSupply) after every generated BUY/REDEEM sequence", () => {
    let seed = 4242n;
    const rand = (n: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed % n;
    };
    let state = S0;
    for (let i = 0; i < 1000; i++) {
      const supplyTokens = state.publicSupplyAtoms / ATOMS_PER_TOKEN;
      const qTokens = 1n + rand(420_000n);
      if (rand(2n) === 0n) {
        // BUY
        if (supplyTokens + qTokens > 21_000_000n) continue;
        try {
          const r = applyMint(state, qTokens * ATOMS_PER_TOKEN);
          state = r.nextState;
        } catch (e) {
          if ((e as CovenantError).code === "ECONOMIC_DUST") continue;
          throw e;
        }
      } else {
        // REDEEM
        if (qTokens > supplyTokens) continue;
        try {
          const r = applyRedeem(state, qTokens * ATOMS_PER_TOKEN);
          state = r.nextState;
        } catch (e) {
          if ((e as CovenantError).code === "ECONOMIC_DUST") continue;
          throw e;
        }
      }
      // invariant holds after every transition
      const st = state.publicSupplyAtoms / ATOMS_PER_TOKEN;
      expect(st >= 0n && st <= 21_000_000n).toBe(true);
      expect(state.reserveSats).toBe(requiredBackingSats(st));
    }
  });
});
