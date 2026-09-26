import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildAppTransitionSigner } from "./transition-signer.js";
import { loadV3AppConfig } from "./config.js";
import { loadMainnetProfile } from "@crclaunch/cove-mainnet";
import { LocalGuardianTransitionSigner, RemoteGuardianTransitionSigner } from "@crclaunch/cove-guardian/v3";

const FIXTURE = resolve(process.cwd(), "../../test/fixtures/mainnet-profile.json");
const ORD = "http://127.0.0.1:4000";
// The fixture profile uses the repo's public test keys: TEST-ONLY bypass.
const TEST_PROFILE = { testOnlyMainnetProfile: loadMainnetProfile(FIXTURE, { allowTestKeys: true }).profile };

describe("buildAppTransitionSigner (§C4)", () => {
  it("always returns a signer — local for non-mainnet, remote for mainnet (no null fallback)", () => {
    const regtest = loadV3AppConfig({});
    const local = buildAppTransitionSigner({} as never, regtest);
    expect(local).toBeInstanceOf(LocalGuardianTransitionSigner);

    const mainnet = loadV3AppConfig({ COVE_NETWORK: "mainnet", COVE_ORD_URL: ORD  }, TEST_PROFILE);
    const remote = buildAppTransitionSigner({} as never, mainnet);
    expect(remote).toBeInstanceOf(RemoteGuardianTransitionSigner);
  });

  it("fails closed on non-mainnet when no local Guardian key is configured", () => {
    const base = loadV3AppConfig({});
    const noKey = { ...base, network: "signet" as const, guardianPrivateKey: null };
    expect(() => buildAppTransitionSigner({} as never, noKey)).toThrow(/local Guardian key/);
  });
});
