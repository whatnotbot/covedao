import { describe, expect, it } from "vitest";
import { parseDisplayTokens, parseBtc, parseSats, atomsToDisplay, formatBtc } from "./format.js";

describe("decimal parsing (§137/§138)", () => {
  it("parses display tokens to atoms with exactly 8 decimals", () => {
    expect(parseDisplayTokens("1")).toBe(100_000_000n);
    expect(parseDisplayTokens("1.5")).toBe(150_000_000n);
    expect(parseDisplayTokens("0.00000001")).toBe(1n);
    expect(parseDisplayTokens("840000000")).toBe(84_000_000n * 1_000_000_000n);
  });

  it("rejects >8 decimals and non-decimal input", () => {
    expect(() => parseDisplayTokens("1.123456789")).toThrow();
    expect(() => parseDisplayTokens("-1")).toThrow();
    expect(() => parseDisplayTokens("1e6")).toThrow();
  });

  it("parses BTC to sats without floats", () => {
    expect(parseBtc("1")).toBe(100_000_000n);
    expect(parseBtc("0.1")).toBe(10_000_000n);
    expect(parseBtc("0.00000001")).toBe(1n);
  });

  it("parses sats as integer", () => {
    expect(parseSats("100000")).toBe(100_000n);
    expect(() => parseSats("1.5")).toThrow();
  });

  it("round-trips atoms → display → atoms", () => {
    for (const n of [0n, 1n, 150_000_000n, 84_000_000n * 100_000_000n]) {
      expect(parseDisplayTokens(atomsToDisplay(n))).toBe(n);
    }
  });

  it("formats BTC without scientific notation", () => {
    expect(formatBtc(100_000_000n)).toBe("1 BTC");
    expect(formatBtc(150_000_000n)).toBe("1.5 BTC");
  });
});
