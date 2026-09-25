import { describe, expect, it } from "vitest";
import { fmtTokens, fmtBtc } from "./format";

/**
 * fmtTokens takes ATOMS. It previously skipped the 1e8 scaling, so the public
 * cap of 840,000,000 tokens rendered as "84000000B" across every page.
 */
describe("fmtTokens", () => {
  const T = 100_000_000n; // 1 token

  it("scales atoms to whole tokens before abbreviating", () => {
    expect(fmtTokens(840_000_000n * T)).toBe("840M");
    expect(fmtTokens(160_000_000n * T)).toBe("160M");
    expect(fmtTokens(1_000_000_000n * T)).toBe("1B");
  });

  it("keeps one decimal place", () => {
    expect(fmtTokens(1_500n * T)).toBe("1.5K");
    expect(fmtTokens(2_300_000n * T)).toBe("2.3M");
  });

  it("drops a trailing .0", () => {
    expect(fmtTokens(2_000n * T)).toBe("2K");
  });

  it("renders small amounts exactly", () => {
    expect(fmtTokens(0n)).toBe("0");
    expect(fmtTokens(1n * T)).toBe("1");
    expect(fmtTokens(999n * T)).toBe("999");
  });

  it("truncates sub-token dust rather than rounding up", () => {
    expect(fmtTokens(T - 1n)).toBe("0");
  });
});

describe("fmtBtc", () => {
  it("formats the full-subscription raise", () => {
    expect(fmtBtc(24_196_788n)).toBe("0.24196788 BTC");
  });

  it("trims trailing zeros and handles whole BTC", () => {
    expect(fmtBtc(100_000_000n)).toBe("1 BTC");
    expect(fmtBtc(0n)).toBe("0 BTC");
  });
});
