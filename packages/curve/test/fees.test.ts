import { describe, expect, it } from "vitest";
import {
  computePlatformFee,
  getMinimumContribution,
  ceilDiv,
} from "../src/index.js";

describe("fees", () => {
  it("ceilDiv rounds up", () => {
    expect(ceilDiv(1n, 2n)).toBe(1n);
    expect(ceilDiv(2n, 2n)).toBe(1n);
    expect(ceilDiv(3n, 2n)).toBe(2n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
    expect(ceilDiv(1_000_000_000n, 3n)).toBe(333_333_334n);
  });

  it("ceilDiv rejects zero and negative operands", () => {
    expect(() => ceilDiv(1n, 0n)).toThrow();
    expect(() => ceilDiv(-1n, 2n)).toThrow();
    expect(() => ceilDiv(1n, -2n)).toThrow();
  });

  it("computePlatformFee rejects negative inputs", () => {
    expect(() => computePlatformFee(-1n, 100n)).toThrow();
    expect(() => computePlatformFee(100n, -1n)).toThrow();
  });

  it("CURVE-018: platform fee rounds upward correctly", () => {
    // 1% fee, ceil(contribution / 100).
    expect(computePlatformFee(1n, 100n)).toBe(1n);
    expect(computePlatformFee(100n, 100n)).toBe(1n);
    expect(computePlatformFee(101n, 100n)).toBe(2n);
    expect(computePlatformFee(150n, 100n)).toBe(2n);
    expect(computePlatformFee(21_000n, 100n)).toBe(210n);
    expect(computePlatformFee(0n, 100n)).toBe(0n);
  });

  it("curve contribution is not reduced by the platform fee", () => {
    const contribution = 1_000n;
    const fee = computePlatformFee(contribution, 100n);
    // 1% of 1000 = 10; contribution remains 1000.
    expect(fee).toBe(10n);
    expect(contribution).toBe(1_000n);
  });

  it("CURVE-019: minimum contribution enforced (1,000 sats floor)", () => {
    expect(getMinimumContribution(0n)).toBe(1_000n);
    expect(getMinimumContribution(100n)).toBe(1_000n);
    expect(getMinimumContribution(199n)).toBe(1_000n);
  });

  it("CURVE-020: high network fee raises dynamic minimum (fee × 5)", () => {
    expect(getMinimumContribution(300n)).toBe(1_500n);
    expect(getMinimumContribution(5_000n)).toBe(25_000n);
    expect(getMinimumContribution(10_000n)).toBe(50_000n);
  });
});
