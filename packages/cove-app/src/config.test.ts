import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadV3AppConfig } from "./config.js";
import { loadMainnetProfile, validateMainnetProfile } from "@crclaunch/cove-mainnet";

const FIXTURE = resolve(process.cwd(), "../../test/fixtures/mainnet-profile.json");
const ORD = "http://127.0.0.1:4000";
// The fixture profile uses the repo's public test keys: TEST-ONLY bypass.
const TEST_PROFILE = { testOnlyMainnetProfile: loadMainnetProfile(FIXTURE, { allowTestKeys: true }).profile };

describe("loadV3AppConfig mainnet path (§15)", () => {
  it("loads the public profile and never a private key", () => {
    const cfg = loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD  }, TEST_PROFILE);
    expect(cfg.network).toBe("mainnet");
    expect(cfg.chainIdentity).toBe("bitcoin-mainnet");
    expect(cfg.guardianPrivateKey).toBeNull();
    expect(cfg.recoveryProfile?.profileVersion).toBe("COVE_V3_VAULT_PROFILE_MAINNET1");
    expect(cfg.recoveryProfile?.recoveryThreshold).toBe(2);
    expect(cfg.recoveryProfile?.recoveryPubkeys).toHaveLength(3);
    expect(cfg.feeScript.toString("hex")).toBe("0014cc1b07838e387deacd0e5232e1e8b49f4c29e484");
    expect(cfg.canaryAllowedTokenIds).toContain("fb960b7e43b92b0a9213cf8d0a4534fb8f5776728499af70bf1c3cc8e6d19469");
    expect(cfg.canaryAllowedWalletScripts).toHaveLength(2);
    // §P1-4: fees are wired from the committed profile, not COVE_FEE_CONFIG defaults.
    expect(cfg.buyFeeBps).toBe(100n);
    expect(cfg.redeemFeeBps).toBe(100n);
  });

  it("fails closed if any local private-key env var is present on mainnet", () => {
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD, COVE_GUARDIAN_PRIVATE_KEY_HEX: "42".repeat(32)  }, TEST_PROFILE)).toThrow(/local Guardian\/recovery\/fee private keys/);
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD, COVE_RECOVERY_PRIVATE_KEY_HEX: "43".repeat(32)  }, TEST_PROFILE)).toThrow(/local Guardian\/recovery\/fee private keys/);
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD, COVE_FEE_PRIVATE_KEY_HEX: "44".repeat(32)  }, TEST_PROFILE)).toThrow(/local Guardian\/recovery\/fee private keys/);
  });

  it("fails closed without an ord server on mainnet (inscriptions and runes)", () => {
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet" }, TEST_PROFILE)).toThrow(/COVE_ORD_URL is required/);
    expect(loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD  }, TEST_PROFILE).ordUrl).toBe(ORD);
  });

  it("fails closed on the committed profile until its owner decisions are filled in", () => {
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD })).toThrow(/invalid mainnet profile: .*OWNER_DECISION_REQUIRED/);
  });

  it("refuses the fixture profile without the test-only bypass (its keys are public)", () => {
    const fixture = TEST_PROFILE.testOnlyMainnetProfile;
    expect(() => loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD }, {})).toThrow();
    expect(validateMainnetProfile(fixture).errors.join()).toMatch(/TEST_KEY_IN_PROFILE/);
  });

  it("loads the secondary Core URL for the two-node quorum (§P1-2)", () => {
    const cfg = loadV3AppConfig({ COVE_BITCOIN_RPC_URL_SECONDARY: "http://127.0.0.1:18444" });
    expect(cfg.coreRpcUrlSecondary).toBe("http://127.0.0.1:18444");
    expect(loadV3AppConfig({}).coreRpcUrlSecondary).toBeUndefined();
  });
});
