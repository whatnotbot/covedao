import { describe, expect, it } from "vitest";
import { MAINNET_GENESIS_HASH, SIGNET_GENESIS_HASH, assertFutureActivationHeight, isMainnetGenesis, isSignetGenesis } from "./chain-assert.js";

describe("isSignetGenesis", () => {
  it("accepts the signet genesis hash", () => {
    expect(isSignetGenesis(SIGNET_GENESIS_HASH)).toBe(true);
  });

  it("accepts the hash with different casing", () => {
    expect(isSignetGenesis(SIGNET_GENESIS_HASH.toUpperCase())).toBe(true);
  });

  it("rejects the mainnet genesis hash", () => {
    expect(isSignetGenesis("000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f")).toBe(false);
  });

  it("rejects the testnet genesis hash", () => {
    expect(isSignetGenesis("000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943")).toBe(false);
  });
});

describe("isMainnetGenesis", () => {
  it("accepts the mainnet genesis hash", () => {
    expect(isMainnetGenesis(MAINNET_GENESIS_HASH)).toBe(true);
  });

  it("rejects the signet genesis hash", () => {
    expect(isMainnetGenesis(SIGNET_GENESIS_HASH)).toBe(false);
  });
});

describe("assertFutureActivationHeight", () => {
  it("accepts a height strictly in the future", () => {
    expect(() => assertFutureActivationHeight(900_000, 850_000)).not.toThrow();
  });

  it("rejects a past height", () => {
    expect(() => assertFutureActivationHeight(800_000, 850_000)).toThrow(/must be in the future/);
  });

  it("rejects an equal height (H must be strictly future)", () => {
    expect(() => assertFutureActivationHeight(850_000, 850_000)).toThrow(/must be in the future/);
  });

  it("rejects a non-positive height", () => {
    expect(() => assertFutureActivationHeight(0, 850_000)).toThrow(/positive integer/);
  });
});
