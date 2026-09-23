import { describe, expect, it } from "vitest";
import {
  COVE_V1_MAINNET_CONFIG,
  COVE_V1_MAINNET_GENESIS_HEIGHT,
  COVE_V1_MAINNET_SETTLEMENT_SCRIPT,
  COVE_V1_MAINNET_TREASURY_SCRIPT,
  isCoveMainnetActivated,
} from "./config.js";

describe("COVE_V1_MAINNET_CONFIG (immutable literal consensus constants)", () => {
  it("is a literal constant, not env-defined", () => {
    // The committed config must reference the literal constants directly.
    expect(COVE_V1_MAINNET_CONFIG.genesisHeight).toBe(COVE_V1_MAINNET_GENESIS_HEIGHT);
    expect(COVE_V1_MAINNET_CONFIG.settlementScript).toBe(COVE_V1_MAINNET_SETTLEMENT_SCRIPT);
    expect(COVE_V1_MAINNET_CONFIG.treasuryScript).toBe(COVE_V1_MAINNET_TREASURY_SCRIPT);
    expect(COVE_V1_MAINNET_CONFIG.network).toBe("mainnet");
  });

  it("is NOT activated until the owner commits a future H and both scripts", () => {
    expect(COVE_V1_MAINNET_GENESIS_HEIGHT).toBe(0);
    expect(isCoveMainnetActivated(COVE_V1_MAINNET_CONFIG)).toBe(false);
  });

  it("reports activated only when H >= 1 and both scripts are non-empty", () => {
    expect(isCoveMainnetActivated({ ...COVE_V1_MAINNET_CONFIG, genesisHeight: 1, settlementScript: "0014", treasuryScript: "0014" })).toBe(true);
    expect(isCoveMainnetActivated({ ...COVE_V1_MAINNET_CONFIG, genesisHeight: 0, settlementScript: "0014", treasuryScript: "0014" })).toBe(false);
    expect(isCoveMainnetActivated({ ...COVE_V1_MAINNET_CONFIG, genesisHeight: 1, settlementScript: "", treasuryScript: "0014" })).toBe(false);
    expect(isCoveMainnetActivated({ ...COVE_V1_MAINNET_CONFIG, genesisHeight: 1, settlementScript: "0014", treasuryScript: "" })).toBe(false);
  });

  it("pins every mainnet economic constant (someone could silently change fees otherwise)", () => {
    expect(COVE_V1_MAINNET_CONFIG.launchFeeSats).toBe(10_000n);
    expect(COVE_V1_MAINNET_CONFIG.primaryMintFeeBps).toBe(100n);
    expect(COVE_V1_MAINNET_CONFIG.minContributionSats).toBe(1_000n);
    expect(COVE_V1_MAINNET_CONFIG.maxFeeRateSatVb).toBe(50n);
    expect(COVE_V1_MAINNET_CONFIG.maxMinerFeeSats).toBe(50_000n);
  });
});
