import { describe, expect, it } from "vitest";
import { SIGNET_GENESIS_HASH, isSignetGenesis } from "./chain-assert.js";

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
