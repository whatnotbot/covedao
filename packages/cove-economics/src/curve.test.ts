import { describe, expect, it } from "vitest";
import { CURVES, PUBLIC_SUPPLY, TOTAL_SUPPLY, RESERVED, geometric20, linearRamp } from "./curve.js";

describe("supply model", () => {
  it("the entire 1,000,000,000 supply is public — nothing is reserved", () => {
    expect(PUBLIC_SUPPLY + RESERVED).toBe(TOTAL_SUPPLY);
    expect(PUBLIC_SUPPLY).toBe(1_000_000_000n);
    expect(RESERVED).toBe(0n);
  });
});

describe("curve properties (all candidates)", () => {
  for (const curve of CURVES) {
    it(`${curve.id}: price is monotonically non-decreasing`, () => {
      let prev = curve.priceAt(0n);
      for (let s = 42_000_000n; s <= PUBLIC_SUPPLY; s += 42_000_000n) {
        const p = curve.priceAt(s);
        expect(p >= prev).toBe(true);
        prev = p;
      }
    });

    it(`${curve.id}: full public raise == integral (path independence within rounding)`, () => {
      const whole = curve.costToBuy(0n, PUBLIC_SUPPLY);
      let split = 0n;
      let s = 0n;
      const step = PUBLIC_SUPPLY / 10n;
      for (let i = 0; i < 10; i++) {
        split += curve.costToBuy(s, step);
        s += step;
      }
      const drift = split - whole;
      expect(drift >= 0n).toBe(true);
      expect(drift <= 10n).toBe(true);
    });

    it(`${curve.id}: integer bigint only (no float)`, () => {
      const c = curve.costToBuy(1_000_000n, 1_000_000n);
      expect(typeof c).toBe("bigint");
    });
  }
});

describe("FROZEN curve: geometric20 (existing 20-stage)", () => {
  it("priceAt golden", () => {
    expect(geometric20.priceAt(0n)).toBe(500n);
    expect(geometric20.priceAt(500_000_000n)).toBe(10_054n); // start of stage 11
    expect(geometric20.priceAt(PUBLIC_SUPPLY)).toBe(149_731n);
  });

  it("costToBuy golden: 50M tokens from supply 0 = 25,000 sats (stage 1)", () => {
    expect(geometric20.costToBuy(0n, 50_000_000n)).toBe(25_000n);
  });

  it("final reserve == 28,805,700 sats (≈ 0.288 BTC benchmark)", () => {
    expect(geometric20.costToBuy(0n, PUBLIC_SUPPLY)).toBe(28_805_700n);
  });

  it("marginal price at 100% == 149,731 sats/M", () => {
    expect(geometric20.priceAt(PUBLIC_SUPPLY)).toBe(149_731n);
  });
});

describe("rejected candidates (documented, not frozen)", () => {
  it("linear ramp raises 75,250,000 sats (2.6× the benchmark) — rejected", () => {
    expect(linearRamp.costToBuy(0n, PUBLIC_SUPPLY)).toBe(75_250_000n);
  });
});
