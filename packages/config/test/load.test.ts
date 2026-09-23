import { describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../src/load.js";

function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    CRC_NETWORK: "mock",
    DATABASE_URL: "postgres://localhost/db",
    ...overrides,
  };
}

describe("validateConfig (fail-closed startup gates)", () => {
  it("refuses a mainnet write flag when CRC_PROTOCOL_VERIFIED is false", () => {
    const config = loadConfig(env({
      CRC_NETWORK: "mainnet",
      CRC_DEPLOY_MAINNET_ENABLED: "true",
      CRC_PROTOCOL_VERIFIED: "false",
      PLATFORM_TREASURY_ADDRESS: "bc1qxyz",
    }));
    expect(() => validateConfig(config)).toThrow(/CRC_PROTOCOL_VERIFIED is false/);
  });

  it("requires ADMIN_AUTH_SECRET in production", () => {
    const config = loadConfig(env({ NODE_ENV: "production", ADMIN_AUTH_SECRET: "" }));
    expect(() => validateConfig(config)).toThrow(/ADMIN_AUTH_SECRET is required/);
  });

  it("rejects a garbage treasury address on a test (non-mock) network", () => {
    const config = loadConfig(env({ CRC_NETWORK: "test", PLATFORM_TREASURY_ADDRESS: "not-an-address" }));
    expect(() => validateConfig(config)).toThrow(/must be a testnet address/);
  });

  it("accepts a valid testnet treasury address on a test network", () => {
    const config = loadConfig(env({ CRC_NETWORK: "test", PLATFORM_TREASURY_ADDRESS: "tb1q000000000000000000000000000000000000000" }));
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects a testnet treasury address on mainnet", () => {
    const config = loadConfig(env({
      CRC_NETWORK: "mainnet",
      CRC_DEPLOY_MAINNET_ENABLED: "true",
      CRC_PROTOCOL_VERIFIED: "true",
      PLATFORM_TREASURY_ADDRESS: "tb1q000000000000000000000000000000000000000",
    }));
    expect(() => validateConfig(config)).toThrow(/must be a mainnet address/);
  });
});
