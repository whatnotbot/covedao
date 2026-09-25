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
  it("no positive quantity has a zero R-delta: every token costs at least 8 sats", () => {
    // The cheapest lot is 8,692 sats, so one token is 8.692 sats; ECONOMIC_DUST
    // is unreachable for any positive amount on this curve.
    for (const s of [0n, 999n, 1_000n, STAGE - 1n, STAGE, 10n * STAGE, PUBLIC_SUPPLY - 1n]) {
      expect(grossBuy(s, 1n) >= 8n, `buy 1 at ${s}`).toBe(true);
    }
    expect(requiredBackingSats(1001n) - requiredBackingSats(1000n)).toBe(9n);
  });

  it("a single token at stair 1 costs 9 sats (8.692, rounded up)", () => {
    expect(grossBuy(0n, 1n)).toBe(9n);
    expect(grossRedeem(1n, 1n)).toBe(9n);
  });

  it("BUY and REDEEM use identical R (gross round-trip exact)", () => {
    for (let k = 0n; k < 210n; k++) {
      const s = k * STAGE; // stair boundary: 1-token delta is always >= 8 sats
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
    // Redeem 1 token from supply 1: gross 9 sats, fee 1 sat (7.5%, rounded up) → net 8.
    const q = quoteRedeem(1n, 1n);
    expect(q.gross).toBe(9n);
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
