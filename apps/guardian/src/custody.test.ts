import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ecc from "tiny-secp256k1";
import { selectCustodyBackend } from "./custody.js";
import {
  FileGuardianCustodyBackend,
  TestGuardianCustodyBackend,
  UnconfiguredGuardianCustodyBackend,
} from "@crclaunch/cove-guardian/v3";

const PRIV = "42".repeat(32);
const XONLY = Buffer.from(ecc.pointFromScalar(Buffer.from(PRIV, "hex"), true)!.subarray(1)).toString("hex");

function keyFile(contents: string, mode: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "guardian-key-")), "guardian.key");
  writeFileSync(path, contents);
  chmodSync(path, mode);
  return path;
}

describe("Guardian custody backend selection (§C5)", () => {
  it("refuses the test backend on mainnet", () => {
    expect(() => selectCustodyBackend("mainnet", { testKeyHex: PRIV })).toThrow(/forbidden on mainnet/);
  });

  it("allows the test backend on regtest/signet/testnet", () => {
    for (const network of ["regtest", "signet", "testnet"]) {
      expect(selectCustodyBackend(network, { testKeyHex: PRIV })).toBeInstanceOf(TestGuardianCustodyBackend);
    }
  });

  it("fails closed (unconfigured) when no key is supplied", () => {
    expect(selectCustodyBackend("mainnet", {})).toBeInstanceOf(UnconfiguredGuardianCustodyBackend);
    expect(selectCustodyBackend("regtest", {})).toBeInstanceOf(UnconfiguredGuardianCustodyBackend);
  });

  it("loads the ceremony key file on mainnet and signs with it", async () => {
    const backend = selectCustodyBackend("mainnet", { keyFile: keyFile(PRIV + "\n", 0o600), expectedXOnlyHex: XONLY });
    expect(backend).toBeInstanceOf(FileGuardianCustodyBackend);
    expect((await backend.xOnlyPubkey()).toString("hex")).toBe(XONLY);
    const sighash = Buffer.alloc(32, 7);
    const sig = await backend.signTaprootScriptPath({ sighash, leafTapleafHash: Buffer.alloc(32) });
    expect(ecc.verifySchnorr(sighash, Buffer.from(XONLY, "hex"), sig)).toBe(true);
  });

  it("refuses a key file others can read", () => {
    expect(() => selectCustodyBackend("mainnet", { keyFile: keyFile(PRIV, 0o644) })).toThrow(/chmod 600/);
  });

  it("refuses a key that is not the profile's Guardian key", () => {
    expect(() => selectCustodyBackend("mainnet", { keyFile: keyFile(PRIV, 0o600), expectedXOnlyHex: "11".repeat(32) })).toThrow(/does not match/);
  });

  it("refuses a malformed key file", () => {
    expect(() => selectCustodyBackend("mainnet", { keyFile: keyFile("not a key", 0o600) })).toThrow(/64 hex/);
  });

  it("refuses both a key file and a test key", () => {
    expect(() => selectCustodyBackend("regtest", { keyFile: keyFile(PRIV, 0o600), testKeyHex: PRIV })).toThrow(/not both/);
  });
});
