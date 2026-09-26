import {
  FileGuardianCustodyBackend,
  TestGuardianCustodyBackend,
  UnconfiguredGuardianCustodyBackend,
  type GuardianCustodyBackend,
} from "@crclaunch/cove-guardian/v3";

/**
 * Select the Guardian custody backend (§C5).
 *
 * - `GUARDIAN_KEY_FILE`: the ceremony's `guardian.key` (mode 0600). The
 *   production backend; allowed on every network, and it must match the
 *   profile's guardianXOnly when one is given.
 * - `GUARDIAN_TEST_KEY_HEX`: REGTEST/tests only. FORBIDDEN on mainnet.
 * - Neither: the fail-closed unconfigured backend, which signs nothing.
 *
 * Setting both is refused, so it is never unclear which key signs.
 */
export function selectCustodyBackend(
  network: string,
  keys: { testKeyHex?: string; keyFile?: string; expectedXOnlyHex?: string },
): GuardianCustodyBackend {
  if (keys.testKeyHex && keys.keyFile) {
    throw new Error("set GUARDIAN_KEY_FILE or GUARDIAN_TEST_KEY_HEX, not both");
  }
  if (network === "mainnet" && keys.testKeyHex) {
    throw new Error("GUARDIAN_TEST_KEY_HEX is forbidden on mainnet — a production custody backend is required");
  }
  if (keys.keyFile) return FileGuardianCustodyBackend.load(keys.keyFile, keys.expectedXOnlyHex);
  return keys.testKeyHex
    ? new TestGuardianCustodyBackend(Buffer.from(keys.testKeyHex, "hex"))
    : new UnconfiguredGuardianCustodyBackend();
}
