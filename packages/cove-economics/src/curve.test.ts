import { describe, expect, it } from "vitest";
import { CURVES, PUBLIC_SUPPLY, TOTAL_SUPPLY, RESERVED, geometric20, linearRamp } from "./curve.js";

describe("supply model", () => {
  it("total = public + reserved = 1,000,000,000", () => {
    expect(PUBLIC_SUPPLY + RESERVED).toBe(TOTAL_SUPPLY);
    expect(PUBLIC_SUPPLY).toBe(840_000_000n);
    expect(RESERVED).toBe(160_000_000n);
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
    expect(geometric20.priceAt(420_000_000n)).toBe(10_054n); // start of stage 11
    expect(geometric20.priceAt(PUBLIC_SUPPLY)).toBe(149_731n);
  });

  it("costToBuy golden: 42M tokens from supply 0 = 21,000 sats (stage 1)", () => {
    expect(geometric20.costToBuy(0n, 42_000_000n)).toBe(21_000n);
  });

  it("final reserve == 24,196,788 sats (≈ 0.242 BTC benchmark)", () => {
    expect(geometric20.costToBuy(0n, PUBLIC_SUPPLY)).toBe(24_196_788n);
  });

  it("marginal price at 100% == 149,731 sats/M", () => {
    expect(geometric20.priceAt(PUBLIC_SUPPLY)).toBe(149_731n);
  });
});

describe("rejected candidates (documented, not frozen)", () => {
  it("linear ramp raises 63,210,000 sats (2.6× the benchmark) — rejected", () => {
    expect(linearRamp.costToBuy(0n, PUBLIC_SUPPLY)).toBe(63_210_000n);
  });
});
