import { describe, expect, it } from "vitest";
import { btcPerKvbToSatPerVb, testMempoolAcceptParams } from "./provider.js";

describe("btcPerKvbToSatPerVb (estimatesmartfee conversion)", () => {
  it("converts 0.00001000 BTC/kvB → 1 sat/vB", () => {
    expect(btcPerKvbToSatPerVb(0.00001)).toBe(1n);
  });

  it("converts 0.00002000 BTC/kvB → 2 sat/vB", () => {
    expect(btcPerKvbToSatPerVb(0.00002)).toBe(2n);
  });

  it("rounds sub-satoshi rates up to at least 1 sat/vB", () => {
    expect(btcPerKvbToSatPerVb(0.00000345)).toBe(1n);
  });

  it("falls back to 2 sat/vB for missing/zero/negative feerate", () => {
    expect(btcPerKvbToSatPerVb(0)).toBe(2n);
    expect(btcPerKvbToSatPerVb(-1)).toBe(2n);
    expect(btcPerKvbToSatPerVb(Number.NaN)).toBe(2n);
    expect(btcPerKvbToSatPerVb(Number.POSITIVE_INFINITY)).toBe(2n);
  });
});

describe("testMempoolAcceptParams (RPC arg shape)", () => {
  it("without maxfeerate → [[hex]]", () => {
    expect(testMempoolAcceptParams("00ff")).toEqual([["00ff"]]);
  });

  it("with maxfeerate → [[hex], maxfeerate] (NOT [[hex, maxfeerate]])", () => {
    expect(testMempoolAcceptParams("00ff", 0.0005)).toEqual([["00ff"], 0.0005]);
  });
});
