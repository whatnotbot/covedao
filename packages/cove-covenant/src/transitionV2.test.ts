import { describe, expect, it } from "vitest";
import { ATOMS_PER_TOKEN } from "@crclaunch/curve";
import { requiredBackingSats } from "@crclaunch/cove-economics";
import { applyMintV2, applyRedeemV2, s0StateV2, validateStateV2 } from "./transitionV2.js";
import { stateHashV2, type CoveStateV2 } from "./stateV2.js";
import { CovenantError } from "./transition.js";

const TOKEN = "cd".repeat(32);
const M = 1_000_000n;

describe("validateStateV2 (§2)", () => {
  function expectError(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error(`expected ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(CovenantError);
      expect((e as CovenantError).code).toBe(code);
    }
  }

  it("S0 is valid", () => {
    expect(() => validateStateV2(s0StateV2({ tokenId: TOKEN }))).not.toThrow();
  });

  it("corrupted backing rejected", () => {
    const s = s0StateV2({ tokenId: TOKEN });
    expectError(
      () =>
        validateStateV2({
          ...s,
          issuedPublicSupplyAtoms: 50n * M * ATOMS_PER_TOKEN,
          curveStage: 2,
          backingSats: 999n,
        }),
      "BACKING_MISMATCH",
    );
  });

  it("corrupted stage rejected", () => {
    const s = {
      ...s0StateV2({ tokenId: TOKEN }),
      issuedPublicSupplyAtoms: 50n * M * ATOMS_PER_TOKEN,
      backingSats: 25_000n,
      curveStage: 1,
    };
    expectError(() => validateStateV2(s), "CURVE_STAGE_MISMATCH");
  });

  it("wrong policy version rejected", () => {
    expectError(
      () => validateStateV2({ ...s0StateV2({ tokenId: TOKEN }), policyVersion: 2 }),
      "BAD_POLICY_VERSION",
    );
  });

  it("zero tokenId rejected", () => {
    expectError(() => validateStateV2(s0StateV2({ tokenId: "00".repeat(32) })), "INVALID_TOKEN_ID");
  });

  it("over-cap state rejected", () => {
    const s = s0StateV2({ tokenId: TOKEN });
    expectError(
      () => validateStateV2({ ...s, issuedPublicSupplyAtoms: 840_000_001n * M * ATOMS_PER_TOKEN }),
      "SUPPLY_OUT_OF_RANGE",
    );
  });
});

describe("applyMintV2 / applyRedeemV2 exact successors", () => {
  it("MINT V2 exact successor: backing recomputed as R(nextSupply)", () => {
    const r = applyMintV2(s0StateV2({ tokenId: TOKEN }), 50n * M * ATOMS_PER_TOKEN);
    expect(r.grossSats).toBe(25_000n);
    expect(r.nextState.issuedPublicSupplyAtoms).toBe(50n * M * ATOMS_PER_TOKEN);
    expect(r.nextState.backingSats).toBe(requiredBackingSats(50n * M));
    expect(r.nextState.curveStage).toBe(2);
    expect(() => validateStateV2(r.nextState)).not.toThrow();
  });

  it("REDEEM V2 exact successor", () => {
    const mint = applyMintV2(s0StateV2({ tokenId: TOKEN }), 42n * M * ATOMS_PER_TOKEN);
    const redeem = applyRedeemV2(mint.nextState, 10n * M * ATOMS_PER_TOKEN);
    expect(redeem.grossSats).toBe(requiredBackingSats(42n * M) - requiredBackingSats(32n * M));
    expect(redeem.nextState.issuedPublicSupplyAtoms).toBe(32n * M * ATOMS_PER_TOKEN);
    expect(redeem.nextState.backingSats).toBe(requiredBackingSats(32n * M));
    expect(() => validateStateV2(redeem.nextState)).not.toThrow();
  });

  it("buy→redeem returns exact backing state", () => {
    const s0 = s0StateV2({ tokenId: TOKEN });
    const mint = applyMintV2(s0, 42n * M * ATOMS_PER_TOKEN);
    const redeem = applyRedeemV2(mint.nextState, 42n * M * ATOMS_PER_TOKEN);
    expect(redeem.nextState.backingSats).toBe(0n);
    expect(redeem.nextState.issuedPublicSupplyAtoms).toBe(0n);
    expect(stateHashV2(redeem.nextState)).toBe(stateHashV2(s0));
  });

  it("long random BUY/REDEEM sequence maintains backing == R(supply)", () => {
    let seed = 77n;
    const rand = (n: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed % n;
    };
    let state: CoveStateV2 = s0StateV2({ tokenId: TOKEN });
    for (let i = 0; i < 1000; i++) {
      const supplyTokens = state.issuedPublicSupplyAtoms / ATOMS_PER_TOKEN;
      const q = 1n + rand(42n * M);
      try {
        if (rand(2n) === 0n) {
          if (supplyTokens + q > 840n * M) continue;
          state = applyMintV2(state, q * ATOMS_PER_TOKEN).nextState;
        } else {
          if (q > supplyTokens) continue;
          state = applyRedeemV2(state, q * ATOMS_PER_TOKEN).nextState;
        }
      } catch (e) {
        if ((e as CovenantError).code === "ECONOMIC_DUST") continue;
        throw e;
      }
      expect(state.backingSats).toBe(
        requiredBackingSats(state.issuedPublicSupplyAtoms / ATOMS_PER_TOKEN),
      );
    }
  });
});
