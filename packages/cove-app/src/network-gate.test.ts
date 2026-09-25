import { describe, expect, it } from "vitest";
import { V3AppService } from "./service.js";
import { loadV3AppConfig } from "./config.js";
import type { GuardianTransitionSigner } from "@crclaunch/cove-guardian/v3";

/**
 * P0-5: never trust `network` from the request body. The mutation gate must
 * come from the server-side `config.network` (fixed at boot), so a client
 * cannot flip a node into a permissive network by editing its JSON body.
 */

const dummySigner = {
  signMint: async () => ({ ok: false, reason: "n/a", detail: "n/a", audit: null }),
  signRedeem: async () => ({ ok: false, reason: "n/a", detail: "n/a", audit: null }),
  health: async () => ({ reachable: true }),
} as GuardianTransitionSigner;

function mainnetService(): V3AppService {
  const base = loadV3AppConfig({}); // regtest defaults (all key material present)
  const config = { ...base, network: "mainnet" as const, enabled: true };
  return new V3AppService({} as never, {} as never, config, dummySigner);
}

const WS = "0014" + "22".repeat(20);

describe("P0-5 mutation network gate is config-driven", () => {
  it("rejects buildLaunch on a mainnet config", async () => {
    const app = mainnetService();
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
    ).rejects.toThrow(/MAINNET_DISABLED/);
  });

  it("rejects buildBackingBuy on a mainnet config", async () => {
    const app = mainnetService();
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
    ).rejects.toThrow(/MAINNET_DISABLED/);
  });

  it("rejects buildRedeem on a mainnet config", async () => {
    const app = mainnetService();
    await expect(
      app.buildRedeem({
        tokenId: "ab".repeat(32),
        amountAtoms: 100_000_000n,
        walletScript: WS,
        walletAddress: null,
        minerFeeSats: 1000n,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/MAINNET_DISABLED/);
  });

  it("rejects buildTransfer on a mainnet config", async () => {
    const app = mainnetService();
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
    ).rejects.toThrow(/MAINNET_DISABLED/);
  });
});
