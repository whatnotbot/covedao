import { describe, expect, it } from "vitest";
import { grossBuy, grossRedeem, quoteBuy, quoteRedeem, requiredBackingSats } from "./backing.js";
import { deterministicFee } from "./fee.js";
import { PUBLIC_SUPPLY } from "./curve.js";

const M = 1_000_000n;
/** One stair: 100,000 tokens. */
const STAGE = 100_000n;

describe("requiredBackingSats R(s) golden vectors (stairs210)", () => {
  it("R(0) = 0, R(100k) = 3,300, R(200k) = 9,900", () => {
    expect(requiredBackingSats(0n)).toBe(0n);
    expect(requiredBackingSats(STAGE)).toBe(3_300n);
    expect(requiredBackingSats(2n * STAGE)).toBe(9_900n);
  });
  it("R(21M) = 73,111,500 sats (full raise)", () => {
    expect(requiredBackingSats(PUBLIC_SUPPLY)).toBe(73_111_500n);
  });
});

describe("quoteBuy / quoteRedeem golden vectors", () => {
  it("buy one stair from 0 = 3,300 gross, 6,248 fee (5,000 + 100 lots × 10 + 7.5%)", () => {
    expect(quoteBuy(0n, STAGE)).toEqual({ gross: 3_300n, fee: 6_248n, net: 9_548n });
  });
  it("redeem one stair from one stair = 3,300 gross, 1,000 fee (7.5%, floored at 1,000)", () => {
    expect(quoteRedeem(STAGE, STAGE)).toEqual({ gross: 3_300n, fee: 1_000n, net: 2_300n });
  });
  it("deterministicFee rounds up", () => {
    expect(deterministicFee(1n, 100n)).toBe(1n); // 0.01 sat → 1 sat
    expect(deterministicFee(21_000n, 100n)).toBe(210n);
  });
});

describe("P0 invariant: buy→redeem round trip cannot drain backing", () => {
  it("gross round trip is exact: grossRedeem(s+q, q) == grossBuy(s, q)", () => {
    for (const [s, q] of [
      [0n, STAGE],
      [STAGE, STAGE],
      [10n * STAGE, 5n * STAGE],
      [209n * STAGE, STAGE],
      [PUBLIC_SUPPLY - STAGE, STAGE],
    ]) {
      const b = grossBuy(s!, q!);
      const r = grossRedeem(s! + q!, q!);
      expect(r).toBe(b);
      expect(requiredBackingSats(s! + q!) - r).toBe(requiredBackingSats(s!));
    }
  });

  it("with fees, user cannot end with more BTC than started", () => {
    for (let i = 1; i <= 210; i++) {
      const s = BigInt(i - 1) * STAGE;
      const q = STAGE;
      const paid = quoteBuy(s, q).net; // buyer pays
      const received = quoteRedeem(s + q, q).net; // seller receives back
      expect(received).toBeLessThan(paid);
    }
  });

  it("thousands of generated vectors conserve backing gross", () => {
    // deterministic pseudo-random sweep across stages + partial stages.
    let seed = 12345n;
    const rand = (n: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const s = rand(210n) * STAGE + rand(STAGE); // 0..21M
      const maxQ = PUBLIC_SUPPLY - s;
      const q = 1n + rand(maxQ);
      const b = grossBuy(s, q);
      const r = grossRedeem(s + q, q);
      expect(r).toBe(b);
    }
  });

  it("redemption reduces issued supply and releases capacity for re-buy", () => {
    // Sell out, redeem 1M, re-buy 1M: capacity is restored.
    expect(requiredBackingSats(PUBLIC_SUPPLY)).toBe(73_111_500n);
    const afterRedeem = PUBLIC_SUPPLY - M;
    const redeemGross = grossRedeem(PUBLIC_SUPPLY, M);
    expect(requiredBackingSats(afterRedeem)).toBe(73_111_500n - redeemGross);
    // 1M is buyable again from afterRedeem.
    expect(() => grossBuy(afterRedeem, M)).not.toThrow();
    expect(requiredBackingSats(afterRedeem) + grossBuy(afterRedeem, M)).toBe(
      requiredBackingSats(PUBLIC_SUPPLY),
    );
  });
});

describe("boundary / failure cases", () => {
  it("zero amount rejected", () => {
    expect(() => grossBuy(0n, 0n)).toThrow();
    expect(() => grossRedeem(STAGE, 0n)).toThrow();
  });
  it("buy beyond cap rejected", () => {
    expect(() => grossBuy(PUBLIC_SUPPLY, 1n)).toThrow(/cap/);
  });
  it("redeem beyond issued rejected", () => {
    expect(() => grossRedeem(STAGE, STAGE + 1n)).toThrow(/issued/);
  });
  it("single-unit quantities work", () => {
    // 1 token at 33 sats a lot is 0.033 sats, rounded up.
    expect(grossBuy(0n, 1n)).toBe(1n);
    expect(grossRedeem(1n, 1n)).toBe(1n);
  });
});
