import { describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../src/load.js";
import { coveMainnetActivationStage } from "../src/flags.js";

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
    expect(() => validateConfig(config)).toThrow(/valid testnet/);
  });

  it("accepts a valid testnet treasury address on a test network", () => {
    const config = loadConfig(env({ CRC_NETWORK: "test", PLATFORM_TREASURY_ADDRESS: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa" }));
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects a testnet treasury address on mainnet", () => {
    const config = loadConfig(env({
      CRC_NETWORK: "mainnet",
      CRC_DEPLOY_MAINNET_ENABLED: "true",
      CRC_PROTOCOL_VERIFIED: "true",
      PLATFORM_TREASURY_ADDRESS: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa",
    }));
    expect(() => validateConfig(config)).toThrow(/valid mainnet/);
  });

  it("rejects a checksum-corrupted bech32 address (real decoding, not regex)", () => {
    const bad = "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fb"; // last char corrupted
    const config = loadConfig(env({ CRC_NETWORK: "test", PLATFORM_TREASURY_ADDRESS: bad }));
    expect(() => validateConfig(config)).toThrow(/valid testnet/);
  });

  it("rejects a checksum-corrupted Base58 mainnet address", () => {
    const bad = "1BoatSLRHtKNngkdXEeobR76b53LETtpyU"; // last char corrupted
    const config = loadConfig(env({
      CRC_NETWORK: "mainnet",
      CRC_DEPLOY_MAINNET_ENABLED: "true",
      CRC_PROTOCOL_VERIFIED: "true",
      PLATFORM_TREASURY_ADDRESS: bad,
    }));
    expect(() => validateConfig(config)).toThrow(/valid mainnet/);
  });

  it("accepts a valid Base58 mainnet address", () => {
    const config = loadConfig(env({
      CRC_NETWORK: "mainnet",
      CRC_DEPLOY_MAINNET_ENABLED: "true",
      CRC_PROTOCOL_VERIFIED: "true",
      PLATFORM_TREASURY_ADDRESS: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
    }));
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("refuses to boot when a Cove mainnet flag is set without a recorded canary", () => {
    const config = loadConfig(env({ COVE_MAINNET_ENABLED: "true" }));
    expect(() => validateConfig(config)).toThrow(/owner canary is not recorded/);
    const config2 = loadConfig(env({ COVE_DEPLOY_MAINNET_ENABLED: "true" }));
    expect(() => validateConfig(config2)).toThrow(/owner canary is not recorded/);
  });

  it("refuses public writes when only the genesis height is set (canary txid missing)", () => {
    const config = loadConfig(env({
      COVE_MAINNET_ENABLED: "true",
      COVE_V1_MAINNET_GENESIS_HEIGHT: "850000",
    }));
    expect(() => validateConfig(config)).toThrow(/owner canary is not recorded/);
  });

  it("refuses public writes when the canary txid is malformed", () => {
    const config = loadConfig(env({
      COVE_MAINNET_ENABLED: "true",
      COVE_V1_MAINNET_GENESIS_HEIGHT: "850000",
      COVE_V1_MAINNET_CANARY_TXID: "not-a-txid",
    }));
    expect(() => validateConfig(config)).toThrow(/owner canary is not recorded/);
  });

  it("accepts OWNER_CANARY stage when genesis + canary txid are recorded and no public writes", () => {
    const config = loadConfig(env({
      COVE_MAINNET_ENABLED: "true",
      COVE_V1_MAINNET_GENESIS_HEIGHT: "850000",
      COVE_V1_MAINNET_CANARY_TXID: "a".repeat(64),
    }));
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("accepts PUBLIC_WRITES stage when canary is recorded and a public flag is set", () => {
    const config = loadConfig(env({
      COVE_DEPLOY_MAINNET_ENABLED: "true",
      COVE_V1_MAINNET_GENESIS_HEIGHT: "850000",
      COVE_V1_MAINNET_CANARY_TXID: "a".repeat(64),
    }));
    expect(() => validateConfig(config)).not.toThrow();
  });
});

describe("coveMainnetActivationStage", () => {
  const base = { COVE_V1_MAINNET_GENESIS_HEIGHT: "850000", COVE_V1_MAINNET_CANARY_TXID: "a".repeat(64) };

  it("is READ_ONLY when no Cove flag is set", () => {
    const config = loadConfig(env());
    expect(coveMainnetActivationStage(config)).toBe("READ_ONLY");
  });

  it("is OWNER_CANARY when only the master switch is set", () => {
    const config = loadConfig(env({ ...base, COVE_MAINNET_ENABLED: "true" }));
    expect(coveMainnetActivationStage(config)).toBe("OWNER_CANARY");
  });

  it("is PUBLIC_WRITES when a public write flag is set", () => {
    const config = loadConfig(env({ ...base, COVE_MINT_MAINNET_ENABLED: "true" }));
    expect(coveMainnetActivationStage(config)).toBe("PUBLIC_WRITES");
  });
});
