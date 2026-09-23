import { describe, expect, it } from "vitest";
import { PUBLIC_SUPPLY } from "./curve.js";
import {
  BackingError,
  grossBuy,
  grossRedeem,
  quoteBuy,
  quoteRedeem,
  requiredBackingSats,
} from "./backing.js";
import { dustThreshold, isDustSafe } from "./dust.js";

const M = 1_000_000n;
const STAGE = 42n * M;

function expectBackingError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected BackingError ${code}`);
  } catch (e) {
    expect(e).toBeInstanceOf(BackingError);
    expect((e as BackingError).code).toBe(code);
  }
}

describe("zero-delta economics (§1.1)", () => {
  it("positive quantity with zero R-delta is rejected (ECONOMIC_DUST)", () => {
    // R(1001) == R(1000) at stage 0 (500 sats/M): a 1-token buy from 1000 is 0 sats.
    expect(requiredBackingSats(1001n)).toBe(requiredBackingSats(1000n));
    expectBackingError(() => grossBuy(1000n, 1n), "ECONOMIC_DUST");
    expectBackingError(() => grossRedeem(1001n, 1n), "ECONOMIC_DUST");
  });

  it("a quantity whose R-delta is 1 sat is accepted", () => {
    expect(grossBuy(0n, 1n)).toBe(1n);
    expect(grossRedeem(1n, 1n)).toBe(1n);
  });

  it("BUY and REDEEM use identical R (gross round-trip exact)", () => {
    for (let k = 0n; k < 20n; k++) {
      const s = k * STAGE; // stage boundary: 1-token delta is always >= 1 sat
      const q = 1n;
      expect(grossRedeem(s + q, q)).toBe(grossBuy(s, q));
    }
  });

  it("rejected dust transition does not modify supply or backing", () => {
    const supply = 1000n;
    const backing = requiredBackingSats(supply);
    expectBackingError(() => grossBuy(supply, 1n), "ECONOMIC_DUST");
    // Unchanged (pure functions; the rejection is before any mutation).
    expect(requiredBackingSats(supply)).toBe(backing);
  });

  it("redemption net payout below destination dust is rejected (P2TR dust=330)", () => {
    // Redeem 1 token from supply 1: gross 1 sat, fee 1 sat (ceil 0.01) → net 0.
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
      const s = rand(20n) * STAGE + rand(STAGE);
      const q = 1n + rand(10n * M);
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

  it("boundary around every geometric20 stage: 1-token buy at stage start is positive", () => {
    for (let k = 0n; k < 20n; k++) {
      const s = k * STAGE;
      const g = grossBuy(s, 1n);
      expect(g >= 1n).toBe(true);
    }
  });
});
