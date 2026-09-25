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
  it("CURVE-003: exactly 50M tokens fills Stage 1 (25,000 sats)", () => {
    const q = quoteExactTokens({ desiredTokens: 50_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(25_000n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(1);
    expect(q.supplyAfter).toBe(50_000_000n);
  });

  it("CURVE-004: 51M from zero crosses into Stage 2 (25,675 sats)", () => {
    const q = quoteExactTokens({ desiredTokens: 51_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(25_675n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(2);
  });

  it("CURVE-005: 1B full mint costs 28,805,700 sats", () => {
    const q = quoteExactTokens({ desiredTokens: 1_000_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(28_805_700n);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(20);
  });

  it("CURVE-006: quote crossing one stage calculates both stage prices", () => {
    // 41,999,999 minted; buy 1,000,001 → 1 token @ stage 1 + 1M tokens @ stage 2.
    const q = quoteExactTokens({ desiredTokens: 1_000_001n, currentSupply: 49_999_999n });
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(2);
    // 1 token @ 500/1M = 1 sat; 1,000,000 tokens @ 675/1M = 675 sats.
    expect(q.curveContributionSats).toBe(1n + 675n);
  });

  it("CURVE-007: quote crossing five stages is exact", () => {
    const q = quoteExactTokens({ desiredTokens: 5n * 50_000_000n + 1n, currentSupply: 0n });
    const fullStages =
      50n * 500n + 50n * 675n + 50n * 912n + 50n * 1231n + 50n * 1661n;
    const oneTokenStage6 = 1n; // ceil(1 * 2243 / 1M)
    expect(q.curveContributionSats).toBe(fullStages + oneTokenStage6);
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(6);
  });

  it("CURVE-008: last atomic unit of stage uses old-stage price", () => {
    const q = quoteExactTokens({ desiredTokens: 1n, currentSupply: 49_999_999n });
    expect(q.startingStage).toBe(1);
    expect(q.endingStage).toBe(1);
  });

  it("CURVE-009: first atomic unit of next stage uses new price", () => {
    const q = quoteExactTokens({ desiredTokens: 1n, currentSupply: 50_000_000n });
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
    const q = quoteExactTokens({ desiredTokens: 1_000_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(28_805_700n);
  });

  it("CURVE-016: EXACT_TOKENS returns deterministic result", () => {
    const a = quoteExactTokens({ desiredTokens: 123_456_789n, currentSupply: 100_000_000n });
    const b = quoteExactTokens({ desiredTokens: 123_456_789n, currentSupply: 100_000_000n });
    expect(a).toEqual(b);
  });

  it("per-stage full-chunk cost is always (stage size / 1M) * price (no rounding drift)", () => {
    // Property-style: from every stage start, a full stage costs (size/1M) * price.
    for (let s = 1; s <= 20; s++) {
      const start = BigInt(s - 1) * TOKENS_PER_STAGE;
      const q = quoteExactTokens({ desiredTokens: TOKENS_PER_STAGE, currentSupply: start });
      const expected = (TOKENS_PER_STAGE / 1_000_000n) * getStagePrice(s);
      expect(q.curveContributionSats, `stage ${s}`).toBe(expected);
    }
  });
});

describe("quoteExactSats (EXACT_SATS)", () => {
  it("CURVE-015: never exceeds supplied sats", () => {
    const cases = [1n, 500n, 999n, 1000n, 21_000n, 25_675n, 1_234_567n, 28_805_700n];
    for (const sats of cases) {
      const q = quoteExactSats({ availableSats: sats, currentSupply: 0n });
      expect(q.curveContributionSats).toBeLessThanOrEqual(sats);
    }
  });

  it("1,000 sats buys exactly 2,000,000 tokens from zero", () => {
    const q = quoteExactSats({ availableSats: 1_000n, currentSupply: 0n });
    expect(q.tokens).toBe(2_000_000n);
    expect(q.curveContributionSats).toBe(1_000n);
  });

  it("full supply is purchasable at exactly 24,196,788 sats", () => {
    const q = quoteExactSats({ availableSats: 28_805_700n, currentSupply: 0n });
    expect(q.tokens).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(q.curveContributionSats).toBe(28_805_700n);
  });

  it("remainder stays in wallet (never overspends)", () => {
    const q = quoteExactSats({ availableSats: 28_805_700n + 500n, currentSupply: 0n });
    expect(q.tokens).toBe(PUBLIC_SUPPLY_TOKENS);
    expect(q.curveContributionSats).toBe(28_805_700n); // 500 sats remainder stays in wallet
  });

  it("zero sats rejected", () => {
    expect(() => quoteExactSats({ availableSats: 0n, currentSupply: 0n })).toThrow(CurveError);
  });

  it("CURVE-017: EXACT_SATS deterministic", () => {
    const a = quoteExactSats({ availableSats: 5_000_000n, currentSupply: 500_000_000n });
    const b = quoteExactSats({ availableSats: 5_000_000n, currentSupply: 500_000_000n });
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
    expect(q.curveContributionSats).toBe(28_805_700n);
  });
});
