import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { buildAppTransitionSigner, watchGuardianAgreement } from "./transition-signer.js";
import { loadV3AppConfig } from "./config.js";
import { loadMainnetProfile } from "@crclaunch/cove-mainnet";
import { LocalGuardianTransitionSigner, RemoteGuardianTransitionSigner, type GuardianTransitionSigner } from "@crclaunch/cove-guardian/v3";

const FIXTURE = resolve(process.cwd(), "../../test/fixtures/mainnet-profile.json");
const RPC = "https://btc.example/api-key-in-url";
// The fixture profile uses the repo's public test keys: TEST-ONLY bypass.
const TEST_PROFILE = { testOnlyMainnetProfile: loadMainnetProfile(FIXTURE, { allowTestKeys: true }).profile };

describe("buildAppTransitionSigner (§C4)", () => {
  it("always returns a signer — local for non-mainnet, remote for mainnet (no null fallback)", () => {
    const regtest = loadV3AppConfig({ COVE_NETWORK: "regtest" });
    const local = buildAppTransitionSigner({} as never, regtest);
    expect(local).toBeInstanceOf(LocalGuardianTransitionSigner);

    const mainnet = loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_BITCOIN_RPC_URL: RPC  }, TEST_PROFILE);
    const remote = buildAppTransitionSigner({} as never, mainnet);
    expect(remote).toBeInstanceOf(RemoteGuardianTransitionSigner);
  });

  it("fails closed on non-mainnet when no local Guardian key is configured", () => {
    const base = loadV3AppConfig({ COVE_NETWORK: "regtest" });
    const noKey = { ...base, network: "signet" as const, guardianPrivateKey: null };
    expect(() => buildAppTransitionSigner({} as never, noKey)).toThrow(/local Guardian key/);
  });
});

describe("watchGuardianAgreement", () => {
  const mainnet = { ...loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_BITCOIN_RPC_URL: RPC }, TEST_PROFILE), guardianEndpoint: "https://guardian.example" };
  const signerWith = (h: { reachable: boolean; reason?: string }) => ({ health: async () => h }) as unknown as GuardianTransitionSigner;
  const settle = () => new Promise((r) => setImmediate(r));

  it("stops the process when the Guardian runs a different profile (e.g. another fee address)", async () => {
    const onMismatch = vi.fn();
    watchGuardianAgreement(signerWith({ reachable: false, reason: "GUARDIAN_PROFILE_MISMATCH: abcd1234…" }), mainnet, { service: "test", onMismatch });
    await settle();
    expect(onMismatch).toHaveBeenCalledWith(expect.stringMatching(/^GUARDIAN_PROFILE_MISMATCH/));
  });

  it("stops the process when mainnet has no Guardian endpoint to compare with", () => {
    const onMismatch = vi.fn();
    watchGuardianAgreement(signerWith({ reachable: true }), { ...mainnet, guardianEndpoint: undefined }, { service: "test", onMismatch });
    expect(onMismatch).toHaveBeenCalledWith(expect.stringMatching(/COVE_GUARDIAN_ENDPOINT/));
  });

  it("keeps running when the profiles match, and retries while the Guardian is unreachable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const onMismatch = vi.fn();
      watchGuardianAgreement(signerWith({ reachable: true }), mainnet, { service: "test", onMismatch });
      const health = vi.fn().mockResolvedValueOnce({ reachable: false, reason: "guardian unreachable" }).mockResolvedValue({ reachable: true });
      watchGuardianAgreement({ health } as unknown as GuardianTransitionSigner, mainnet, { service: "test", onMismatch, retryMs: 1_000 });
      await settle();
      vi.advanceTimersByTime(1_000);
      await settle();
      expect(health).toHaveBeenCalledTimes(2);
      expect(onMismatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing off mainnet", async () => {
    const health = vi.fn();
    watchGuardianAgreement({ health } as unknown as GuardianTransitionSigner, loadV3AppConfig({ COVE_NETWORK: "regtest" }), { service: "test" });
    await settle();
    expect(health).not.toHaveBeenCalled();
  });
});
