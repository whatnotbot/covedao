import { describe, expect, it } from "vitest";
import { grossBuy, grossRedeem, quoteBuy, quoteRedeem, requiredBackingSats } from "./backing.js";
import { deterministicFee } from "./fee.js";
import { PUBLIC_SUPPLY } from "./curve.js";

const M = 1_000_000n;
const STAGE = 50n * M;

describe("requiredBackingSats R(s) golden vectors (geometric20)", () => {
  it("R(0) = 0, R(50M) = 25,000, R(100M) = 58,750", () => {
    expect(requiredBackingSats(0n)).toBe(0n);
    expect(requiredBackingSats(STAGE)).toBe(25_000n);
    expect(requiredBackingSats(2n * STAGE)).toBe(58_750n);
  });
  it("R(1B) = 28,805,700 sats (full raise)", () => {
    expect(requiredBackingSats(PUBLIC_SUPPLY)).toBe(28_805_700n);
  });
});

describe("quoteBuy / quoteRedeem golden vectors", () => {
  it("buy 50M from 0 = 25,000 gross, 250 fee (1%)", () => {
    expect(quoteBuy(0n, STAGE)).toEqual({ gross: 25_000n, fee: 250n, net: 25_250n });
  });
  it("redeem 50M from 50M = 25,000 gross, 250 fee (1%)", () => {
    expect(quoteRedeem(STAGE, STAGE)).toEqual({ gross: 25_000n, fee: 250n, net: 24_750n });
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
      [19n * STAGE, STAGE],
      [PUBLIC_SUPPLY - STAGE, STAGE],
    ]) {
      const b = grossBuy(s!, q!);
      const r = grossRedeem(s! + q!, q!);
      expect(r).toBe(b);
      expect(requiredBackingSats(s! + q!) - r).toBe(requiredBackingSats(s!));
    }
  });

  it("with fees, user cannot end with more BTC than started", () => {
    for (let i = 1; i <= 20; i++) {
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
      const s = rand(20n) * STAGE + rand(STAGE); // 0..1B
      const maxQ = PUBLIC_SUPPLY - s;
      const q = 1n + rand(maxQ);
      const b = grossBuy(s, q);
      const r = grossRedeem(s + q, q);
      expect(r).toBe(b);
    }
  });

  it("redemption reduces issued supply and releases capacity for re-buy", () => {
    // Sell out, redeem 10M, re-buy 10M: capacity is restored.
    expect(requiredBackingSats(PUBLIC_SUPPLY)).toBe(28_805_700n);
    const afterRedeem = PUBLIC_SUPPLY - 10n * M;
    const redeemGross = grossRedeem(PUBLIC_SUPPLY, 10n * M);
    expect(requiredBackingSats(afterRedeem)).toBe(28_805_700n - redeemGross);
    // 10M is buyable again from afterRedeem.
    expect(() => grossBuy(afterRedeem, 10n * M)).not.toThrow();
    expect(requiredBackingSats(afterRedeem) + grossBuy(afterRedeem, 10n * M)).toBe(
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
    // 1 token = 1 display token; price ~500 sats/M ⇒ ~0 sats per token, rounded up.
    expect(grossBuy(0n, 1n)).toBe(1n);
    expect(grossRedeem(1n, 1n)).toBe(1n);
  });
});
