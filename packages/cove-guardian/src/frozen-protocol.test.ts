import { describe, expect, it } from "vitest";
import { COVE_STATE_V2_DOMAIN, COVE_STATE_V2_VERSION, TOKEN_CARRIER_SATS } from "@crclaunch/cove-covenant";
import { COVE_POLICY_V3, COVE_WIRE_V2 } from "@crclaunch/cove-wire";
import { PUBLIC_SUPPLY, RESERVED, TOTAL_SUPPLY, geometric20 } from "@crclaunch/cove-economics";
import { MINT_CMR, REDEEM_CMR } from "@crclaunch/cove-simplicity";
import { RESERVE_ANCHOR_SATS } from "./v3/builder.js";

/**
 * Core-freeze manifest (§35). These constants are FROZEN for the V3 protocol.
 * Changing any of them requires an explicit protocol-version update, never a
 * casual edit. This test is the CI tripwire that fails if a future agent drifts
 * a frozen constant.
 */
describe("Cove V3 core-freeze manifest", () => {
  it("wire version is frozen at 2", () => expect(COVE_WIRE_V2).toBe(2));
  it("state version is frozen at 2", () => expect(COVE_STATE_V2_VERSION).toBe(2));
  it("policy version is frozen at 3", () => expect(COVE_POLICY_V3).toBe(3));
  it("state domain is frozen", () => expect(COVE_STATE_V2_DOMAIN).toBe("Cove/State/v2"));
  it("MINT V3 CMR is frozen", () =>
    expect(MINT_CMR).toBe("ccdb02000fdb372bfa2e166b9fe0192715d555fc5720f8008ee741fe1a0d58ec"));
  it("REDEEM V3 CMR is frozen", () =>
    expect(REDEEM_CMR).toBe("37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56"));
  it("curve id is frozen at geometric20", () => expect(geometric20.id).toBe("geometric20"));
  it("public supply cap is frozen at 840M display tokens", () => expect(PUBLIC_SUPPLY).toBe(1_000_000_000n));
  it("total supply is frozen at 1B", () => expect(TOTAL_SUPPLY).toBe(1_000_000_000n));
  it("no token reserve is allocated — the curve sells the whole supply", () => expect(RESERVED).toBe(0n));
  it("token carrier sats are frozen at 1000", () => expect(TOKEN_CARRIER_SATS).toBe(1_000n));
  it("backing anchor sats are frozen at 10000", () => expect(RESERVE_ANCHOR_SATS).toBe(10_000n));
});
