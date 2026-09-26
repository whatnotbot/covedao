import { describe, expect, it } from "vitest";
import { V3AppService } from "./service.js";
import { loadV3AppConfig } from "./config.js";
import type { GuardianTransitionSigner } from "@crclaunch/cove-guardian/v3";

/**
 * P0-5: never trust `network` from the request body. The mutation gate comes
 * from the server-side config (fixed at boot): a disabled app refuses every
 * mutation whatever the request says. Mainnet itself is gated at boot by
 * loadV3AppConfig (profile, no local keys, ord) — see config.test.ts.
 */

const dummySigner = {
  signMint: async () => ({ ok: false, reason: "n/a", detail: "n/a", audit: null }),
  signRedeem: async () => ({ ok: false, reason: "n/a", detail: "n/a", audit: null }),
  health: async () => ({ reachable: true }),
} as GuardianTransitionSigner;

function disabledService(): V3AppService {
  const base = loadV3AppConfig({}); // regtest defaults (all key material present)
  const config = { ...base, enabled: false };
  return new V3AppService({} as never, {} as never, config, dummySigner);
}

const WS = "0014" + "22".repeat(20);

describe("P0-5 mutation network gate is config-driven", () => {
  it("rejects buildLaunch on a disabled config", async () => {
    const app = disabledService();
    await expect(
      app.buildLaunch({
        ticker: "TST",
        nonceHex: "11".repeat(32),
        walletScript: WS,
        walletAddress: null,
        funding: [],
        minerFeeSats: 1000n,
        metadata: { displayName: "T", description: "D" },
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/APP_DISABLED/);
  });

  it("rejects buildBackingBuy on a disabled config", async () => {
    const app = disabledService();
    await expect(
      app.buildBackingBuy({
        tokenId: "ab".repeat(32),
        amountAtoms: 100_000_000n,
        quoteBinding: { stateHash: "", backingOutpoint: { txid: "", vout: 0 }, expiresAtHeight: null },
        walletScript: WS,
        walletAddress: null,
        funding: [],
        minerFeeSats: 1000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/APP_DISABLED/);
  });

  it("rejects buildRedeem on a disabled config", async () => {
    const app = disabledService();
    await expect(
      app.buildRedeem({
        tokenId: "ab".repeat(32),
        amountAtoms: 100_000_000n,
        walletScript: WS,
        walletAddress: null,
        minerFeeSats: 1000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/APP_DISABLED/);
  });

  it("rejects buildTransfer on a disabled config", async () => {
    const app = disabledService();
    await expect(
      app.buildTransfer({
        tokenId: "ab".repeat(32),
        amountAtoms: 100_000_000n,
        recipientScript: WS,
        walletScript: WS,
        walletAddress: null,
        funding: [],
        minerFeeSats: 1000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/APP_DISABLED/);
  });
});
