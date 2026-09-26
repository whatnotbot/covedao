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

  it("total supply is 2.1e15 atoms (fits uint64)", () => {
    expect(TOTAL_SUPPLY_ATOMS).toBe(21_000_000n * ATOMS_PER_TOKEN);
    expect(TOTAL_SUPPLY_ATOMS).toBe(2_100_000_000_000_000n);
    expect(TOTAL_SUPPLY_ATOMS).toBeLessThan(2n ** 64n);
  });

  it("public supply and price unit are atom-denominated", () => {
    expect(PUBLIC_SUPPLY_ATOMS).toBe(PUBLIC_SUPPLY_TOKENS * ATOMS_PER_TOKEN);
    expect(PRICE_UNIT_ATOMS).toBe(PRICE_UNIT_TOKENS * ATOMS_PER_TOKEN);
    expect(PRICE_UNIT_ATOMS).toBe(1_000_000n * 100_000_000n);
  });
});

describe("Golden economics (unchanged by atom model)", () => {
  it("one lot (1,000 tokens) at supply 0 → 27 sats", () => {
    const q = quoteExactTokens({ desiredTokens: 1_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(27n);
  });

  it("full public mint (21,000,000 tokens) → 59,818,500 sats", () => {
    expect(getTheoreticalFullRaise()).toBe(59_818_500n);
    const q = quoteExactTokens({ desiredTokens: 21_000_000n, currentSupply: 0n });
    expect(q.curveContributionSats).toBe(59_818_500n);
  });

  it("stair boundary crossing is preserved (100k/stair)", () => {
    // Stair 1 is exactly 100 lots at 27 sats = 2,700 sats.
    const stair1 = quoteExactTokens({ desiredTokens: 100_000n, currentSupply: 0n });
    expect(stair1.curveContributionSats).toBe(2_700n);
    expect(stair1.endingStage).toBe(1);
    // The next lot starts stair 2 at 54 sats.
    const stair2 = quoteExactTokens({ desiredTokens: 1_000n, currentSupply: 100_000n });
    expect(stair2.curveContributionSats).toBe(54n);
    expect(stair2.startingStage).toBe(2);
  });
});
