import { TestGuardianCustodyBackend, UnconfiguredGuardianCustodyBackend, type GuardianCustodyBackend } from "@crclaunch/cove-guardian/v3";

/**
 * Select the Guardian custody backend (§C5). The REGTEST/tests-only
 * `TestGuardianCustodyBackend` is FORBIDDEN on mainnet — selecting it there
 * refuses to boot. Otherwise, a test key selects the test backend and no key
 * selects the fail-closed unconfigured backend.
 */
export function selectCustodyBackend(network: string, testKeyHex: string | undefined): GuardianCustodyBackend {
  if (network === "mainnet" && testKeyHex) {
    throw new Error("GUARDIAN_TEST_KEY_HEX is forbidden on mainnet — a production custody backend is required");
  }
  return testKeyHex
    ? new TestGuardianCustodyBackend(Buffer.from(testKeyHex, "hex"))
    : new UnconfiguredGuardianCustodyBackend();
}
