import { describe, expect, it } from "vitest";
import { treasuryAddress, MOCK_TREASURY_ADDRESS } from "./treasury";

describe("treasuryAddress (fail-closed)", () => {
  it("returns the mock address for mock network", () => {
    expect(treasuryAddress({ network: "mock", treasuryAddress: null })).toBe(MOCK_TREASURY_ADDRESS);
  });

  it("returns the configured address when present", () => {
    expect(treasuryAddress({ network: "test", treasuryAddress: "tb1q000000000000000000000000000000000000000" })).toBe(
      "tb1q000000000000000000000000000000000000000",
    );
  });

  it("throws (never returns empty) on a non-mock network without an address", () => {
    expect(() => treasuryAddress({ network: "test", treasuryAddress: null })).toThrow(
      /PLATFORM_TREASURY_ADDRESS is required/,
    );
  });
});
