import { describe, expect, it } from "vitest";
import {
  ATOMS_PER_TOKEN,
  DECIMALS,
  PUBLIC_SUPPLY_ATOMS,
  PUBLIC_SUPPLY_TOKENS,
  PRICE_UNIT_ATOMS,
  PRICE_UNIT_TOKENS,
  TOTAL_SUPPLY_ATOMS,
  getTheoreticalFullRaise,
  quoteExactTokens,
} from "../src/index.js";

/**
 * Golden unit-model + economics tests. These lock the 8-decimal atom model and
 * prove the original curve economics are numerically unchanged.
 */
describe("Cove atom unit model (8 decimals)", () => {
  it("defines 8 decimals and 1 token = 100,000,000 atoms", () => {
    expect(DECIMALS).toBe(8);
    expect(ATOMS_PER_TOKEN).toBe(100_000_000n);
  });

  it("1 display token = 100,000,000 atoms", () => {
    expect(ATOMS_PER_TOKEN).toBe(100_000_000n);
  });

  it("1,000,000 display tokens = 100,000,000,000,000 atoms", () => {
    expect(1_000_000n * ATOMS_PER_TOKEN).toBe(100_000_000_000_000n);
  });

  it("total supply is 1e17 atoms (fits uint64)", () => {
    expect(TOTAL_SUPPLY_ATOMS).toBe(1_000_000_000n * ATOMS_PER_TOKEN);
    expect(TOTAL_SUPPLY_ATOMS).toBe(100_000_000_000_000_000n);
    expect(TOTAL_SUPPLY_ATOMS).toBeLessThan(2n ** 64n);
  });

  it("public supply and price unit are atom-denominated", () => {
    expect(PUBLIC_SUPPLY_ATOMS).toBe(PUBLIC_SUPPLY_TOKENS * ATOMS_PER_TOKEN);
    expect(PRICE_UNIT_ATOMS).toBe(PRICE_UNIT_TOKENS * ATOMS_PER_TOKEN);
    expect(PRICE_UNIT_ATOMS).toBe(1_000_000n * 100_000_000n);
  });
});

describe("Golden economics (unchanged by atom model)", () => {
  it("1,000,000 display tokens at supply 0 → 500 sats", () => {
    const q = quoteExactTokens({ desiredTokens: 1_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(500n);
  });

  it("full public mint (840,000,000 display tokens) → 24,196,788 sats", () => {
    expect(getTheoreticalFullRaise()).toBe(28_805_700n);
    const q = quoteExactTokens({ desiredTokens: 1_000_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(28_805_700n);
  });

  it("stage boundary crossing is preserved (50M/stage)", () => {
    // Stage 1 is exactly 50,000,000 display tokens at 500 sats/1M = 25,000 sats.
    const stage1 = quoteExactTokens({ desiredTokens: 50_000_000n, currentSupply: 0n });
    expect(stage1.curveContributionSats).toBe(25_000n);
    expect(stage1.endingStage).toBe(1);
    // Next token starts stage 2 at 675 sats/1M.
    const stage2 = quoteExactTokens({ desiredTokens: 1n, currentSupply: 50_000_000n });
    expect(stage2.curveContributionSats).toBe(1n); // ceil(1*675/1M)
    expect(stage2.startingStage).toBe(2);
  });
});
