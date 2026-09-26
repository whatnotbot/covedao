import { describe, expect, it } from "vitest";
import { PUBLIC_SUPPLY } from "./curve.js";
import {
  type BackingError,
  grossBuy,
  grossRedeem,
  quoteBuy,
  quoteRedeem,
  requiredBackingSats,
} from "./backing.js";
import { dustThreshold, isDustSafe } from "./dust.js";

const M = 1_000_000n;
/** One stair: 100,000 tokens. */
const STAGE = 100_000n;


describe("zero-delta economics (§1.1)", () => {
  it("no whole lot has a zero R-delta: every lot costs at least 27 sats", () => {
    // Mints and sell-backs move whole lots of 1,000, so this is the case that
    // matters; the cheapest lot is 27 sats.
    for (const s of [0n, 1_000n, STAGE - 1_000n, STAGE, 10n * STAGE, PUBLIC_SUPPLY - 1_000n]) {
      expect(grossBuy(s, 1_000n) >= 27n, `buy a lot at ${s}`).toBe(true);
    }
    expect(requiredBackingSats(2_000n) - requiredBackingSats(1_000n)).toBe(27n);
  });

  it("a sub-lot quantity that would cost nothing is refused, never free", () => {
    // At 0.027 sats a token, a single token between two roundings is a 0-sat
    // delta; the curve throws rather than handing it out.
    expect(() => grossBuy(999n, 1n)).toThrow(/zero backing delta/);
  });

  it("a single token at stair 1 costs 1 sat (0.027, rounded up)", () => {
    expect(grossBuy(0n, 1n)).toBe(1n);
    expect(grossRedeem(1n, 1n)).toBe(1n);
  });

  it("BUY and REDEEM use identical R (gross round-trip exact)", () => {
    for (let k = 0n; k < 210n; k++) {
      const s = k * STAGE; // stair boundary: 1-token delta is always >= 1 sat
      const q = 1n;
      expect(grossRedeem(s + q, q)).toBe(grossBuy(s, q));
    }
  });

  it("a rejected transition does not modify supply or backing", () => {
    const supply = PUBLIC_SUPPLY;
    const backing = requiredBackingSats(supply);
    expect(() => grossBuy(supply, 1n)).toThrow(/cap/);
    // Unchanged (pure functions; the rejection is before any mutation).
    expect(requiredBackingSats(supply)).toBe(backing);
  });

  it("redemption net payout below destination dust is rejected (P2TR dust=330)", () => {
    // Redeem 1 token from supply 1: gross 1 sat, fee floored at 1,000 → nothing to pay out.
    const q = quoteRedeem(1n, 1n);
    expect(q.gross).toBe(1n);
    const p2tr = Buffer.from("5120" + "ab".repeat(32), "hex");
    expect(dustThreshold(p2tr)).toBe(330n);
    expect(isDustSafe(q.net, p2tr)).toBe(false);
    // A large redeem is dust-safe.
    const big = quoteRedeem(STAGE, STAGE);
    expect(isDustSafe(big.net, p2tr)).toBe(true);
  });

  it("no rounding rule can increase user BTC in buy→redeem", () => {
    let seed = 99n;
    const rand = (n: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      const s = rand(210n) * STAGE + rand(STAGE);
      const q = 1n + rand(M);
      if (s + q > PUBLIC_SUPPLY) continue;
      let paid: bigint;
      let received: bigint;
      try {
        paid = quoteBuy(s, q).net;
        received = quoteRedeem(s + q, q).net;
      } catch (e) {
        if ((e as BackingError).code === "ECONOMIC_DUST") continue;
        throw e;
      }
      expect(received).toBeLessThan(paid);
    }
  });

  it("every accepted positive transition has gross >= 1 (thousands of vectors)", () => {
    let seed = 7n;
    const rand = (n: bigint): bigint => {
      seed = (seed * 1103515245n + 12345n) & ((1n << 31n) - 1n);
      return seed % n;
    };
    for (let i = 0; i < 20000; i++) {
      const s = rand(PUBLIC_SUPPLY + 1n);
      const q = 1n + rand(PUBLIC_SUPPLY - s + 1n);
      try {
        const g = grossBuy(s, q);
        expect(g >= 1n).toBe(true);
      } catch (e) {
        expect((e as BackingError).code).toBe("ECONOMIC_DUST");
      }
    }
  });

  it("boundary around every stairs210 stage: 1-token buy at stage start is positive", () => {
    for (let k = 0n; k < 210n; k++) {
      const s = k * STAGE;
      const g = grossBuy(s, 1n);
      expect(g >= 1n).toBe(true);
    }
  });
});
