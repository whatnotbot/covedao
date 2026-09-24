import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadV3AppConfig } from "./config.js";

const FIXTURE = resolve(process.cwd(), "../../test/fixtures/mainnet-profile.json");

describe("loadV3AppConfig mainnet path (§15)", () => {
  it("loads the public profile and never a private key", () => {
    const cfg = loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_V3_MAINNET_PROFILE_PATH: FIXTURE });
    expect(cfg.network).toBe("mainnet");
    expect(cfg.chainIdentity).toBe("bitcoin-mainnet");
    expect(cfg.guardianPrivateKey).toBeNull();
    expect(cfg.recoveryProfile?.profileVersion).toBe("COVE_V3_VAULT_PROFILE_MAINNET1");
    expect(cfg.recoveryProfile?.recoveryThreshold).toBe(2);
    expect(cfg.recoveryProfile?.recoveryPubkeys).toHaveLength(3);
    expect(cfg.feeScript.toString("hex")).toBe("0014cc1b07838e387deacd0e5232e1e8b49f4c29e484");
    expect(cfg.canaryAllowedTokenIds).toContain("4710488a0ab304fb2316e0174360a41937e1f0a81f2b26dee5a38ef79fb2d252");
    expect(cfg.canaryAllowedWalletScripts).toHaveLength(2);
  });

  it("fails closed if any local private-key env var is present on mainnet", () => {
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_V3_MAINNET_PROFILE_PATH: FIXTURE, COVE_GUARDIAN_PRIVATE_KEY_HEX: "42".repeat(32) })).toThrow(/local Guardian\/recovery\/fee private keys/);
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_V3_MAINNET_PROFILE_PATH: FIXTURE, COVE_RECOVERY_PRIVATE_KEY_HEX: "43".repeat(32) })).toThrow(/local Guardian\/recovery\/fee private keys/);
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_V3_MAINNET_PROFILE_PATH: FIXTURE, COVE_FEE_PRIVATE_KEY_HEX: "44".repeat(32) })).toThrow(/local Guardian\/recovery\/fee private keys/);
  });

  it("fails closed on a missing/invalid profile", () => {
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_V3_MAINNET_PROFILE_PATH: "/nonexistent.json" })).toThrow();
  });
});
