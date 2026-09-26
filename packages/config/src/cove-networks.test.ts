import { describe, expect, it } from "vitest";
import { COVE_NETWORK_SETTINGS, coveNetworkSettings, requireCoveNetwork } from "./cove-networks.js";

describe("committed Cove network settings", () => {
  it("requires COVE_NETWORK with no default", () => {
    expect(() => requireCoveNetwork({})).toThrow(/required/);
    expect(() => requireCoveNetwork({ COVE_NETWORK: "" })).toThrow(/required/);
    expect(() => requireCoveNetwork({ COVE_NETWORK: "main" })).toThrow(/not one of/);
    expect(requireCoveNetwork({ COVE_NETWORK: "signet" })).toBe("signet");
  });

  it("mainnet has an explorer, esplora and an ord server, and ignores env overrides", () => {
    const env = { NEXT_PUBLIC_EXPLORER_URL: "http://x", COVE_ESPLORA_URL: "http://x", COVE_ORD_URL: "http://x", COVE_WORKER_POLL_MS: "1", COVE_V3_DISCOVERY_ENVELOPE: "true" };
    expect(coveNetworkSettings("mainnet", env)).toEqual(COVE_NETWORK_SETTINGS.mainnet);
    expect(COVE_NETWORK_SETTINGS.mainnet.ordUrl).toMatch(/^https:\/\//);
    expect(COVE_NETWORK_SETTINGS.mainnet.explorerUrl).toMatch(/^https:\/\//);
    expect(COVE_NETWORK_SETTINGS.mainnet.esploraUrl).toMatch(/^https:\/\//);
  });

  it("off mainnet, local tooling may override (e.g. Mutinynet runs as signet)", () => {
    const s = coveNetworkSettings("signet", { NEXT_PUBLIC_EXPLORER_URL: "https://mutinynet.com/", COVE_ESPLORA_URL: "https://mutinynet.com/api", COVE_WORKER_POLL_MS: "1500" });
    expect(s.explorerUrl).toBe("https://mutinynet.com");
    expect(s.esploraUrl).toBe("https://mutinynet.com/api");
    expect(s.workerPollMs).toBe(1500);
    expect(coveNetworkSettings("signet", {})).toEqual(COVE_NETWORK_SETTINGS.signet);
  });
});
