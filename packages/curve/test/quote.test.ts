import { describe, expect, it } from "vitest";
import {
  quoteExactTokens,
  quoteExactSats,
  getStagePrice,
  CurveError,
  PUBLIC_SUPPLY_TOKENS,
  TOKENS_PER_STAGE,
} from "../src/index.js";

const M = 1_000_000n;

describe("quoteExactTokens (EXACT_TOKENS)", () => {
  it("CURVE-003: exactly 100k tokens fills stair 1 (869,200 sats)", () => {
    const q = quoteExactTokens({ desiredTokens: 100_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(869_200n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(1);
    expect(q.supplyAfter).toBe(100_000n);
  });

  it("CURVE-004: 101k from zero crosses into stair 2 (878,266 sats)", () => {
    const q = quoteExactTokens({ desiredTokens: 101_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(878_266n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(2);
  });

  it("CURVE-005: 21M full mint costs 1,003,275,000 sats", () => {
    const q = quoteExactTokens({ desiredTokens: 21_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(1_003_275_000n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(210);
  });

  it("CURVE-006: quote crossing one stair calculates both stair prices", () => {
    // 99,999 minted; buy 1,001 → 1 token @ stair 1 + one lot @ stair 2.
    const q = quoteExactTokens({ desiredTokens: 1_001n, currentSupply: 99_999n });
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(2);
    // ceil(1 × 8,692,000 / 1M) = 9; 1,000 tokens @ 9,066 a lot = 9,066.
    expect(q.curveContributionSats).toBe(9n + 9_066n);
  });

  it("CURVE-007: quote crossing five stairs is exact", () => {
    const q = quoteExactTokens({ desiredTokens: 5n * 100_000n + 1n, currentSupply: 0n });
    const fullStairs = 100n * (8_692n + 9_066n + 9_440n + 9_814n + 10_188n);
    const oneTokenStair6 = 11n; // ceil(1 * 10,562,000 / 1M)
    expect(q.curveContributionSats).toBe(fullStairs + oneTokenStair6);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(6);
  });

  it("CURVE-008: last atomic unit of stair uses old-stair price", () => {
    const q = quoteExactTokens({ desiredTokens: 1n, currentSupply: 99_999n });
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(1);
  });

  it("CURVE-009: first atomic unit of next stair uses new price", () => {
    const q = quoteExactTokens({ desiredTokens: 1n, currentSupply: 100_000n });
    expect(q.startingStage).toBe(2);
    expect(q.endingStage).toBe(2);
  });

  it("CURVE-010: request greater than remaining public supply is rejected", () => {
    expect(() =>
      quoteExactTokens({ desiredTokens: PUBLIC_SUPPLY_TOKENS + 1n, currentSupply: 0n }),
    ).toThrow(CurveError);
    expect(() =>
      quoteExactTokens({ desiredTokens: 2n, currentSupply: PUBLIC_SUPPLY_TOKENS - 1n }),
    ).toThrow(CurveError);
  });

  it("CURVE-011: zero-token quote rejected", () => {
    expect(() => quoteExactTokens({ desiredTokens: 0n, currentSupply: 0n })).toThrow(
      CurveError,
    );
  });

  it("CURVE-012: negative quantity impossible", () => {
    expect(() => quoteExactTokens({ desiredTokens: -1n, currentSupply: 0n })).toThrow();
    expect(() => quoteExactTokens({ desiredTokens: 1n, currentSupply: -5n })).toThrow(
      CurveError,
    );
  });

  it("CURVE-013: integer overflow impossible for maximum values (BigInt)", () => {
    const huge = 2n ** 128n;
    expect(() =>
      quoteExactTokens({ desiredTokens: huge, currentSupply: 0n }),
    ).toThrow(CurveError); // rejected for exceeding supply, not overflow
    // A valid full-range quote must still be exact.
    const q = quoteExactTokens({ desiredTokens: 21_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(1_003_275_000n);
  });

  it("CURVE-016: EXACT_TOKENS returns deterministic result", () => {
    const a = quoteExactTokens({ desiredTokens: 1_234_567n, currentSupply: 1_000_000n });
    const b = quoteExactTokens({ desiredTokens: 1_234_567n, currentSupply: 1_000_000n });
    expect(a).toEqual(b);
  });

  it("per-stair full-chunk cost is always size × price / 1M (no rounding drift)", () => {
    // Property-style: from every stair start, a full stair costs size × price / 1M.
    for (let s = 1; s <= 210; s++) {
      const start = BigInt(s - 1) * TOKENS_PER_STAGE;
      const q = quoteExactTokens({ desiredTokens: TOKENS_PER_STAGE, currentSupply: start });
      const expected = (TOKENS_PER_STAGE * getStagePrice(s)) / 1_000_000n;
      expect(q.curveContributionSats, `stage ${s}`).toBe(expected);
    }
  });
});

describe("quoteExactSats (EXACT_SATS)", () => {
  it("CURVE-015: never exceeds supplied sats", () => {
    const cases = [1n, 500n, 8_691n, 8_692n, 21_000n, 878_266n, 1_234_567n, 1_003_275_000n];
    for (const sats of cases) {
      const q = quoteExactSats({ availableSats: sats, currentSupply: 0n });
      expect(q.curveContributionSats).toBeLessThanOrEqual(sats);
    }
  });

  it("8,692 sats buys exactly one lot (1,000 tokens) from zero", () => {
    const q = quoteExactSats({ availableSats: 8_692n, currentSupply: 0n });
    expect(q.tokens).toBe(1_000n);
    expect(q.curveContributionSats).toBe(8_692n);
  });

  it("full supply is purchasable at exactly 1,003,275,000 sats", () => {
    const q = quoteExactSats({ availableSats: 1_003_275_000n, currentSupply: 0n });
    expect(q.tokens).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(q.curveContributionSats).toBe(1_003_275_000n);
  });

  it("remainder stays in wallet (never overspends)", () => {
    const q = quoteExactSats({ availableSats: 1_003_275_000n + 500n, currentSupply: 0n });
    expect(q.tokens).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(q.curveContributionSats).toBe(1_003_275_000n); // 500 sats remainder stays in wallet
  });

  it("zero sats rejected", () => {
    expect(() => quoteExactSats({ availableSats: 0n, currentSupply: 0n })).toThrow(CurveError);
  });

  it("CURVE-017: EXACT_SATS deterministic", () => {
    const a = quoteExactSats({ availableSats: 5_000_000n, currentSupply: 10_000_000n });
    const b = quoteExactSats({ availableSats: 5_000_000n, currentSupply: 10_000_000n });
    expect(a).toEqual(b);
  });

  it("sold-out supply rejected", () => {
    expect(() =>
      quoteExactSats({ availableSats: 1_000n, currentSupply: PUBLIC_SUPPLY_TOKENS }),
    ).toThrow(CurveError);
  });

  it("EXACT_SATS with huge sats never overspends and caps at public supply", () => {
    const q = quoteExactSats({ availableSats: 2n ** 64n, currentSupply: 0n });
    expect(q.tokens).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(q.curveContributionSats).toBe(1_003_275_000n);
  });

  it("stops, rather than spinning, when fewer sats are left than one token costs", () => {
    const q = quoteExactSats({ availableSats: 5n, currentSupply: 0n });
    expect(q.tokens).toBe(0n);
    expect(q.curveContributionSats).toBe(0n);
  });
});
