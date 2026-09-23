import { describe, expect, it } from "vitest";
import { assertCanaryPreflightGates } from "./mainnet-canary.js";

describe("assertCanaryPreflightGates (pre-canary; no fabricated proof required)", () => {
  it("allows a fresh genuine canary to start with NO pre-existing proof", () => {
    // The bootstrap gate was circular: it required the canary proof before the
    // canary that produces it could run. A fresh canary (no flags, no proof)
    // must pass the preflight.
    expect(() => assertCanaryPreflightGates({})).not.toThrow();
  });

  it("rejects a public write flag while the canary runs", () => {
    expect(() => assertCanaryPreflightGates({ COVE_DEPLOY_MAINNET_ENABLED: "true" })).toThrow(/must be false/);
    expect(() => assertCanaryPreflightGates({ COVE_MINT_MAINNET_ENABLED: "true" })).toThrow(/must be false/);
    expect(() => assertCanaryPreflightGates({ COVE_TRANSFER_MAINNET_ENABLED: "true" })).toThrow(/must be false/);
  });

  it("does not require COVE_MAINNET_ENABLED (post-canary gate, not pre-canary)", () => {
    // COVE_MAINNET_ENABLED=true alone (no proof) is the POST-canary gate's
    // concern, not the preflight. The preflight only closes public writes.
    expect(() => assertCanaryPreflightGates({ COVE_MAINNET_ENABLED: "true" })).not.toThrow();
  });
});
