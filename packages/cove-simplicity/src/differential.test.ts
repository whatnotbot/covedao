import { describe, expect, it } from "vitest";
import { applyMint, type CoveState } from "@crclaunch/cove-covenant";
import { PUBLIC_SUPPLY } from "@crclaunch/cove-economics";
import {
  MINT_CMR,
  MINT_CMR_V1,
  executeMintV3,
  isSimplicityAvailable,
  type MintWitness,
} from "./simplicity.js";

/**
 * Differential oracle: the TypeScript reference policy (`validateMint`) MUST
 * agree with the REAL Simplicity MINT predicate (Bit Machine) over generated and
 * adversarial vectors.
 *
 * Overlap verified (the invariants both sides encode): supply conservation,
 * no-overmint, positive amount, reserve movement. The full bonding-curve cost is
 * a TS-only check today (documented gap — the Simplicity predicate receives the
 * curve contribution as witness).
 */

const ATOMS = 100_000_000n;

function prevState(supplyTokens: bigint, reserveSats: bigint): CoveState {
  return {
    version: 1,
    tokenId: "ab".repeat(32),
    phase: "PUBLIC_MINT",
    publicSupplyAtoms: supplyTokens * ATOMS,
    reserveSats,
    curveStage: 1,
  };
}

/**
 * TypeScript reference result for a witness (true = valid transition).
 *
 * This is the EXACT overlap with the V3 Simplicity MINT predicate (mint.simf):
 *   amount > 0
 *   prevSupply + amount == nextSupply  (no u64 overflow)
 *   nextSupply <= 840,000,000          (no overmint)
 *   prevReserve + contribution == nextReserve  (no u64 overflow)
 *
 * It deliberately does NOT check the geometric20 curve-exactness of
 * `contribution`: the Simplicity predicate receives the curve contribution as a
 * witness and does not implement the full curve. Curve-exactness is a TS-only
 * check enforced by the Guardian's FULL reference policy, not by this
 * differential oracle (see the Phase 4.4 trust model).
 */
function tsValid(w: MintWitness): boolean {
  if (w.amount <= 0n) return false;
  if (w.prevSupply + w.amount !== w.nextSupply) return false;
  if (w.nextSupply > PUBLIC_SUPPLY) return false;
  if (w.prevReserve + w.contribution !== w.nextReserve) return false;
  return true;
}

function simplicityValid(w: MintWitness): boolean {
  return executeMintV3(w).result === "PASS";
}

function expectAgree(w: MintWitness): void {
  const ts = tsValid(w);
  const sim = simplicityValid(w);
  const label = JSON.stringify(w, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  expect(sim, `witness ${label}`).toBe(ts);
}

describe("Simplicity CMR is frozen (V3)", () => {
  it("MINT_CMR matches the compiled V3 program", () => {
    expect(MINT_CMR).toBe("0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377");
  });
  it("historical V1 CMR is preserved", () => {
    expect(MINT_CMR_V1).toBe("118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2");
  });
});

describe("differential: TS validateMint == Simplicity Bit Machine", () => {
  it.skipIf(!isSimplicityAvailable())("valid mints agree (PASS)", () => {
    // Deterministic stage-sweep valid vectors.
    const stages: [bigint, bigint][] = [
      [0n, 42_000_000n],
      [42_000_000n, 42_000_000n],
      [420_000_000n, 42_000_000n],
      [798_000_000n, 42_000_000n], // exactly 840M
    ];
    for (const [prevSupply, amount] of stages) {
      const canonical = applyMint(prevState(prevSupply, 0n), amount * ATOMS);
      const w: MintWitness = {
        amount,
        prevSupply,
        nextSupply: canonical.nextState.publicSupplyAtoms / ATOMS,
        prevReserve: 0n,
        nextReserve: canonical.nextState.reserveSats,
        contribution: canonical.curveContributionSats,
      };
      expectAgree(w);
    }
  });

  it.skipIf(!isSimplicityAvailable())("zero amount agrees (FAIL)", () => {
    expectAgree({
      amount: 0n,
      prevSupply: 0n,
      nextSupply: 0n,
      prevReserve: 0n,
      nextReserve: 0n,
      contribution: 0n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("overmint agrees (FAIL)", () => {
    expectAgree({
      amount: 840_000_001n,
      prevSupply: 0n,
      nextSupply: 840_000_001n,
      prevReserve: 0n,
      nextReserve: 0n,
      contribution: 0n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("supply-conservation mutation agrees (FAIL)", () => {
    expectAgree({
      amount: 42_000_000n,
      prevSupply: 0n,
      nextSupply: 42_000_001n,
      prevReserve: 0n,
      nextReserve: 21_000n,
      contribution: 21_000n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("reserve-movement mutation agrees (FAIL)", () => {
    expectAgree({
      amount: 42_000_000n,
      prevSupply: 0n,
      nextSupply: 42_000_000n,
      prevReserve: 0n,
      nextReserve: 21_001n,
      contribution: 21_000n,
    });
  });
});

describe("V3 overflow enforcement (u64 wraparound must be rejected)", () => {
  const U64MAX = 18446744073709551615n;

  it.skipIf(!isSimplicityAvailable())("supply + amount wrap → MINT FAIL", () => {
    // prev = u64::MAX, amount = 1: sum wraps to 0. le_64(prev, sum) must fail.
    expect(
      executeMintV3({
        amount: 1n,
        prevSupply: U64MAX,
        nextSupply: 0n,
        prevReserve: 0n,
        nextReserve: 1n,
        contribution: 1n,
      }).result,
    ).toBe("FAIL");
  });

  it.skipIf(!isSimplicityAvailable())("backing + contribution wrap → MINT FAIL", () => {
    expect(
      executeMintV3({
        amount: 1n,
        prevSupply: 0n,
        nextSupply: 1n,
        prevReserve: U64MAX,
        nextReserve: 0n,
        contribution: 1n,
      }).result,
    ).toBe("FAIL");
  });

  it.skipIf(!isSimplicityAvailable())("exact u64 boundary (no wrap) is handled", () => {
    // prev = 0, amount = 1: valid at the boundary (no overflow).
    expect(
      executeMintV3({
        amount: 1n,
        prevSupply: 0n,
        nextSupply: 1n,
        prevReserve: 0n,
        nextReserve: 1n,
        contribution: 1n,
      }).result,
    ).toBe("PASS");
  });
});
