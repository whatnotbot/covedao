import { describe, expect, it } from "vitest";
import {
  getStageForSupply,
  getStagePrice,
  getStageSupplyRange,
  CurveError,
  isCurveError,
  STAGE_PRICES_SATS_PER_MILLION,
  TOKENS_PER_STAGE,
  PUBLIC_SUPPLY_TOKENS,
  STAGE_COUNT,
} from "../src/index.js";

describe("stage pricing", () => {
  it("CURVE-001: stair 1 costs 33 sats a lot (33,000 sats / 1M)", () => {
    expect(getStagePrice(1)).toBe(33_000n);
  });

  it("CURVE-002: stair 210 costs 6,930 sats a lot (6,930,000 sats / 1M)", () => {
    expect(getStagePrice(210)).toBe(6_930_000n);
  });

  it("every stair is exactly 33 sats a lot dearer than the one below", () => {
    for (let i = 1; i < STAGE_PRICES_SATS_PER_MILLION.length; i++) {
      expect(STAGE_PRICES_SATS_PER_MILLION[i]! - STAGE_PRICES_SATS_PER_MILLION[i - 1]!).toBe(33_000n);
    }
  });

  it("prices are strictly increasing", () => {
    for (let i = 1; i < STAGE_PRICES_SATS_PER_MILLION.length; i++) {
      expect(STAGE_PRICES_SATS_PER_MILLION[i]!).toBeGreaterThan(
        STAGE_PRICES_SATS_PER_MILLION[i - 1]!,
      );
    }
  });

  it("getStagePrice rejects out-of-range stages", () => {
    expect(() => getStagePrice(0)).toThrow(CurveError);
    expect(() => getStagePrice(211)).toThrow(CurveError);
    expect(() => getStagePrice(1.5)).toThrow(CurveError);
    expect(() => getStagePrice(-1)).toThrow(CurveError);
  });

  it("getStageForSupply maps supply boundaries correctly (property-style)", () => {
    // Stair s covers supply [ (s-1)*100k, s*100k ).
    for (let s = 1; s <= STAGE_COUNT; s++) {
      const start = BigInt(s - 1) * TOKENS_PER_STAGE;
      const end = BigInt(s) * TOKENS_PER_STAGE;
      expect(getStageForSupply(start), `stage ${s} start`).toBe(s);
      if (s < STAGE_COUNT) {
        expect(getStageForSupply(end - 1n), `stage ${s} last token`).toBe(s);
        expect(getStageForSupply(end), `stage ${s} next token`).toBe(s + 1);
      }
    }
  });

  it("supply at/above public supply clamps to final stage", () => {
    expect(getStageForSupply(PUBLIC_SUPPLY_TOKENS)).toBe(STAGE_COUNT);
    expect(getStageForSupply(PUBLIC_SUPPLY_TOKENS + 1n)).toBe(STAGE_COUNT);
  });

  it("negative supply throws", () => {
    expect(() => getStageForSupply(-1n)).toThrow(CurveError);
  });

  it("getStageSupplyRange returns inclusive ranges", () => {
    expect(getStageSupplyRange(1)).toEqual({ start: 0n, end: 100_000n });
    expect(getStageSupplyRange(210)).toEqual({ start: 20_900_000n, end: 21_000_000n });
  });

  it("getStageSupplyRange rejects invalid stages", () => {
    expect(() => getStageSupplyRange(0)).toThrow(CurveError);
    expect(() => getStageSupplyRange(211)).toThrow(CurveError);
  });

  it("isCurveError type guard works", () => {
    const err = new CurveError("X", "y");
    expect(isCurveError(err)).toBe(true);
    expect(isCurveError(new Error("nope"))).toBe(false);
    expect(isCurveError(null)).toBe(false);
  });
});
