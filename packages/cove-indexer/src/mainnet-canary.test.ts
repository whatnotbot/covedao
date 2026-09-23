import { describe, expect, it } from "vitest";
import { assertMainnetRuntimeGates } from "./mainnet-canary.js";

const FULL_PROOF = {
  COVE_MAINNET_ENABLED: "true",
  COVE_V1_MAINNET_GENESIS_HEIGHT: "850000",
  COVE_V1_MAINNET_CANARY_DEPLOY_TXID: "a".repeat(64),
  COVE_V1_MAINNET_CANARY_MINT_TXID: "b".repeat(64),
  COVE_V1_MAINNET_CANARY_TRANSFER_TXID: "c".repeat(64),
  COVE_V1_MAINNET_CANARY_STATE_ROOT: "d".repeat(64),
  COVE_V1_MAINNET_CANARY_REPLAY_ROOT: "d".repeat(64),
};

describe("assertMainnetRuntimeGates (A-1 — gates are loaded by the broadcast process)", () => {
  it("refuses with mainnet flags at their defaults", () => {
    expect(() => assertMainnetRuntimeGates({})).toThrow(/COVE_MAINNET_ENABLED must be true/);
  });

  it("refuses when mainnet is enabled but the canary proof is incomplete", () => {
    expect(() => assertMainnetRuntimeGates({ COVE_MAINNET_ENABLED: "true" })).toThrow(/full owner canary proof is not recorded/);
  });

  it("accepts a complete canary proof with mainnet enabled", () => {
    expect(() => assertMainnetRuntimeGates(FULL_PROOF)).not.toThrow();
  });
});
