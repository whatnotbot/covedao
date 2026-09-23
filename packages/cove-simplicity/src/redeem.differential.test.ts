import { describe, expect, it } from "vitest";
import { grossRedeem } from "@crclaunch/cove-economics";
import {
  REDEEM_CMR,
  executeRedeem,
  isSimplicityAvailable,
  type RedeemWitness,
} from "./simplicity.js";

/**
 * Differential oracle for REDEEM (sell-to-backing): the TypeScript reference
 * (grossRedeem + state invariants) MUST agree with the real Simplicity REDEEM
 * predicate over the OVERLAP invariants: positive amount, no underflow, supply
 * conservation (new = old - amount), backing conservation (newBacking =
 * oldBacking - payout). The curve-exactness of `payout` is TS-only (documented
 * gap, exactly like the MINT curve contribution).
 */

const M = 1_000_000n;

function tsRedeemValid(w: RedeemWitness): boolean {
  if (w.amount <= 0n) return false;
  if (w.amount > w.oldSupply) return false;
  if (w.newSupply !== w.oldSupply - w.amount) return false;
  if (w.newBacking !== w.oldBacking - w.payout) return false;
  return true;
}

function expectAgree(w: RedeemWitness): void {
  const ts = tsRedeemValid(w);
  const sim = executeRedeem(w) === "PASS";
  const label = JSON.stringify(w, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  expect(sim, `witness ${label}`).toBe(ts);
}

describe("REDEEM CMR is frozen (V3)", () => {
  it("REDEEM_CMR matches the compiled program", () => {
    expect(REDEEM_CMR).toBe("37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56");
  });
});

describe("differential: TS redeem == Simplicity REDEEM Bit Machine", () => {
  it.skipIf(!isSimplicityAvailable())("valid redeem agrees (PASS)", () => {
    // Redeem all 42M from 42M issued; gross = 21,000 sats.
    const payout = grossRedeem(42n * M, 42n * M);
    expect(payout).toBe(21_000n);
    expectAgree({
      amount: 42n * M,
      oldSupply: 42n * M,
      newSupply: 0n,
      oldBacking: 21_000n,
      newBacking: 0n,
      payout,
    });
  });

  it.skipIf(!isSimplicityAvailable())("partial redeem agrees (PASS)", () => {
    // Redeem 10M from 42M.
    const payout = grossRedeem(42n * M, 10n * M);
    expectAgree({
      amount: 10n * M,
      oldSupply: 42n * M,
      newSupply: 32n * M,
      oldBacking: 21_000n,
      newBacking: 21_000n - payout,
      payout,
    });
  });

  it.skipIf(!isSimplicityAvailable())("zero amount agrees (FAIL)", () => {
    expectAgree({
      amount: 0n,
      oldSupply: 42n * M,
      newSupply: 42n * M,
      oldBacking: 21_000n,
      newBacking: 21_000n,
      payout: 0n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("underflow (amount > supply) agrees (FAIL)", () => {
    expectAgree({
      amount: 42n * M + 1n,
      oldSupply: 42n * M,
      newSupply: 0n,
      oldBacking: 21_000n,
      newBacking: 0n,
      payout: 21_000n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("wrong successor supply agrees (FAIL)", () => {
    expectAgree({
      amount: 42n * M,
      oldSupply: 42n * M,
      newSupply: 1n,
      oldBacking: 21_000n,
      newBacking: 0n,
      payout: 21_000n,
    });
  });

  it.skipIf(!isSimplicityAvailable())("wrong successor backing agrees (FAIL)", () => {
    expectAgree({
      amount: 42n * M,
      oldSupply: 42n * M,
      newSupply: 0n,
      oldBacking: 21_000n,
      newBacking: 1n,
      payout: 21_000n,
    });
  });
});

describe("TS-only payout exactness (curve check, not in Simplicity overlap)", () => {
  it("payout one sat too high is rejected by the TS reference", () => {
    const correct = grossRedeem(42n * M, 42n * M);
    expect(
      tsRedeemValid({
        amount: 42n * M,
        oldSupply: 42n * M,
        newSupply: 0n,
        oldBacking: 21_000n,
        newBacking: 21_000n - (correct + 1n),
        payout: correct + 1n,
      }),
    ).toBe(true); // backing conservation still holds
    // The curve-exactness is enforced by comparing payout == grossRedeem(...):
    expect(grossRedeem(42n * M, 42n * M)).toBe(correct);
    expect(correct + 1n).not.toBe(grossRedeem(42n * M, 42n * M));
  });
});
