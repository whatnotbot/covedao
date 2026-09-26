import { describe, expect, it } from "vitest";
import { CURVES, PUBLIC_SUPPLY, TOTAL_SUPPLY, RESERVED, stairs210, linearRamp } from "./curve.js";

describe("supply model", () => {
  it("the entire 21,000,000 supply is public — nothing is reserved", () => {
    expect(PUBLIC_SUPPLY + RESERVED).toBe(TOTAL_SUPPLY);
    expect(PUBLIC_SUPPLY).toBe(21_000_000n);
    expect(RESERVED).toBe(0n);
  });
});

describe("curve properties (all candidates)", () => {
  for (const curve of CURVES) {
    it(`${curve.id}: price is monotonically non-decreasing`, () => {
      let prev = curve.priceAt(0n);
      for (let s = 1_000_000n; s <= PUBLIC_SUPPLY; s += 1_000_000n) {
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

describe("FROZEN curve: stairs210 (210 even stairs of 100k tokens)", () => {
  it("priceAt golden (sats per 1M tokens = lot price × 1,000)", () => {
    expect(stairs210.priceAt(0n)).toBe(33_000n);
    expect(stairs210.priceAt(10_500_000n)).toBe(3_498_000n); // start of stair 106
    expect(stairs210.priceAt(PUBLIC_SUPPLY)).toBe(6_930_000n);
  });

  it("costToBuy golden: one stair (100k tokens) from supply 0 = 3,300 sats", () => {
    expect(stairs210.costToBuy(0n, 100_000n)).toBe(3_300n);
  });

  it("final reserve == 73,111,500 sats (0.731 BTC)", () => {
    expect(stairs210.costToBuy(0n, PUBLIC_SUPPLY)).toBe(73_111_500n);
  });

  it("marginal price at 100% == 6,930 sats a lot", () => {
    expect(stairs210.priceAt(PUBLIC_SUPPLY)).toBe(6_930_000n);
  });

  it("asking for more than the supply is refused, not looped on", () => {
    expect(() => stairs210.costToBuy(0n, PUBLIC_SUPPLY + 1n)).toThrow(/beyond the public supply/);
  });
});

describe("rejected candidates (documented, not frozen)", () => {
  it("linear ramp over the same supply raises 1,580,250 sats — rejected", () => {
    expect(linearRamp.costToBuy(0n, PUBLIC_SUPPLY)).toBe(1_580_250n);
  });
});
