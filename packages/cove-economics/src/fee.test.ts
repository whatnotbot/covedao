import { describe, expect, it } from "vitest";
import { deterministicFee } from "./fee.js";

/**
 * The flat component exists to keep the fee output above Bitcoin's relay dust
 * threshold. A pure-percentage fee put a hard floor of ~29,300 sats on every
 * buy AND every redemption, locking small holders out of the exit entirely.
 */
describe("the flat component clears the dust threshold", () => {
  const P2WPKH_DUST = 294n;

  it("charges flat + percentage, rounding the percentage up", () => {
    // 2,500 flat + ceil(25,000 x 7.5%) = 2,500 + 1,875
    expect(deterministicFee(25_000n, 750n, 2_500n)).toBe(4_375n);
  });

  it("keeps a tiny trade's fee above dust, where a pure percentage could not", () => {
    const tiny = 500n; // ~$0.50
    expect(deterministicFee(tiny, 750n)).toBeLessThan(P2WPKH_DUST); // old model: refused
    expect(deterministicFee(tiny, 750n, 2_500n)).toBeGreaterThan(P2WPKH_DUST);
  });

  it("clears dust even at the smallest possible gross", () => {
    expect(deterministicFee(1n, 0n, 2_500n)).toBe(2_500n);
  });

  it("still charges nothing on a zero gross", () => {
    expect(deterministicFee(0n, 750n, 2_500n)).toBe(0n);
  });

  it("behaves exactly as before when no flat is given", () => {
    expect(deterministicFee(25_000n, 100n)).toBe(250n);
  });

  it("rejects a negative flat", () => {
    expect(() => deterministicFee(1_000n, 100n, -1n)).toThrow(/non-negative/);
  });
});
