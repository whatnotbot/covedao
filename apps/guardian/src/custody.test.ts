import { describe, expect, it } from "vitest";
import { selectCustodyBackend } from "./custody.js";
import { TestGuardianCustodyBackend, UnconfiguredGuardianCustodyBackend } from "@crclaunch/cove-guardian/v3";

describe("Guardian custody backend selection (§C5)", () => {
  it("refuses the test backend on mainnet", () => {
    expect(() => selectCustodyBackend("mainnet", "42".repeat(32))).toThrow(/forbidden on mainnet/);
  });

  it("allows the test backend on regtest/signet/testnet", () => {
    for (const network of ["regtest", "signet", "testnet"]) {
      expect(selectCustodyBackend(network, "42".repeat(32))).toBeInstanceOf(TestGuardianCustodyBackend);
    }
  });

  it("fails closed (unconfigured) when no test key is supplied", () => {
    expect(selectCustodyBackend("mainnet", undefined)).toBeInstanceOf(UnconfiguredGuardianCustodyBackend);
    expect(selectCustodyBackend("regtest", undefined)).toBeInstanceOf(UnconfiguredGuardianCustodyBackend);
  });
});
