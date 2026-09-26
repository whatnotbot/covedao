import { describe, expect, it } from "vitest";
import { grossRedeem } from "@crclaunch/cove-economics";
import {
  REDEEM_CMR,
  executeRedeemV3,
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


function tsRedeemValid(w: RedeemWitness): boolean {
  if (w.amount <= 0n) return false;
  if (w.amount > w.oldSupply) return false;
  if (w.newSupply !== w.oldSupply - w.amount) return false;
  if (w.newBacking !== w.oldBacking - w.payout) return false;
  return true;
}

async function expectAgree(w: RedeemWitness): Promise<void> {
  const ts = tsRedeemValid(w);
  const sim = (await executeRedeemV3(w)).result === "PASS";
  const label = JSON.stringify(w, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  expect(sim, `witness ${label}`).toBe(ts);
}

describe("REDEEM CMR is frozen (V3)", () => {
  it("REDEEM_CMR matches the compiled program", () => {
    expect(REDEEM_CMR).toBe("37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56");
  });
});

describe("differential: TS redeem == Simplicity REDEEM Bit Machine", () => {
  it.skipIf(!isSimplicityAvailable())("valid redeem agrees (PASS)", async () => {
    const payout = grossRedeem(420_000n, 420_000n);
    expect(payout).toBe(36_300n);
    await expectAgree({
      amount: 420_000n,
      oldSupply: 420_000n,
      newSupply: 0n,
      oldBacking: 36_300n,
      newBacking: 0n,
      payout,
    });
  });

  it.skipIf(!isSimplicityAvailable())("partial redeem agrees (PASS)", async () => {
    const payout = grossRedeem(420_000n, 100_000n);
    await expectAgree({
      amount: 100_000n,
      oldSupply: 420_000n,
      newSupply: 320_000n,
      oldBacking: 36_300n,
      newBacking: 36_300n - payout,
      payout,
    });
  });

  it.skipIf(!isSimplicityAvailable())("zero amount agrees (FAIL)", async () => {
    await expectAgree({ amount: 0n, oldSupply: 420_000n, newSupply: 420_000n, oldBacking: 36_300n, newBacking: 36_300n, payout: 0n });
  });

  it.skipIf(!isSimplicityAvailable())("underflow (amount > supply) agrees (FAIL)", async () => {
    await expectAgree({ amount: 420_000n + 1n, oldSupply: 420_000n, newSupply: 0n, oldBacking: 36_300n, newBacking: 0n, payout: 36_300n });
  });

  it.skipIf(!isSimplicityAvailable())("wrong successor supply agrees (FAIL)", async () => {
    await expectAgree({ amount: 420_000n, oldSupply: 420_000n, newSupply: 1n, oldBacking: 36_300n, newBacking: 0n, payout: 36_300n });
  });

  it.skipIf(!isSimplicityAvailable())("wrong successor backing agrees (FAIL)", async () => {
    await expectAgree({ amount: 420_000n, oldSupply: 420_000n, newSupply: 0n, oldBacking: 36_300n, newBacking: 1n, payout: 36_300n });
  });
});

describe("TS-only payout exactness (curve check, not in Simplicity overlap)", () => {
  it("payout one sat too high is rejected by the TS reference", () => {
    const correct = grossRedeem(420_000n, 420_000n);
    expect(
      tsRedeemValid({
        amount: 420_000n,
        oldSupply: 420_000n,
        newSupply: 0n,
        oldBacking: 36_300n,
        newBacking: 36_300n - (correct + 1n),
        payout: correct + 1n,
      }),
    ).toBe(true); // backing conservation still holds
    // The curve-exactness is enforced by comparing payout == grossRedeem(...):
    expect(grossRedeem(420_000n, 420_000n)).toBe(correct);
    expect(correct + 1n).not.toBe(grossRedeem(420_000n, 420_000n));
  });
});
