import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CoveChainView } from "@crclaunch/cove-covenant";
import { dev1RecoveryProfile, type VaultRecoveryProfile } from "@crclaunch/cove-vault";
import { validateMintTransitionV3, validateRedeemTransitionV3 } from "./validate.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function xonly(byte: number): Buffer {
  return Buffer.from(ECPair.fromPrivateKey(Buffer.alloc(32, byte)).publicKey.subarray(1));
}

const guardianXOnly = xonly(0x42);
const recoveryKeyXOnly = xonly(0x43);
const feeScript = Buffer.from("0014" + "f".repeat(40), "hex");

const MAINNET1: VaultRecoveryProfile = {
  profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
  recoveryCsvBlocks: 2016,
  recoveryThreshold: 2,
  recoveryPubkeys: [xonly(0x51), xonly(0x52), xonly(0x53)],
};

describe("mainnet fail-closed guard (§36)", () => {
  it("rejects a mainnet MINT without any recovery profile", () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    const view = new CoveChainView();
    const r = validateMintTransitionV3({ psbt, view, network: "mainnet", guardianXOnly, recoveryKeyXOnly, feeScript });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("MAINNET_PROFILE_REQUIRED");
  });

  it("rejects a mainnet MINT with the DEV1 single-key profile", () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    const view = new CoveChainView();
    const r = validateMintTransitionV3({
      psbt, view, network: "mainnet", guardianXOnly, recoveryKeyXOnly,
      recoveryProfile: dev1RecoveryProfile(recoveryKeyXOnly), feeScript,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("MAINNET_PROFILE_REQUIRED");
  });

  it("rejects a mainnet REDEEM without the MAINNET1 profile", () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    const view = new CoveChainView();
    const r = validateRedeemTransitionV3({ psbt, view, network: "mainnet", guardianXOnly, recoveryKeyXOnly, feeScript });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("MAINNET_PROFILE_REQUIRED");
  });

  it("passes the profile guard for a MAINNET1 mainnet request (fails later on structure, not the guard)", () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    const view = new CoveChainView();
    const r = validateMintTransitionV3({
      psbt, view, network: "mainnet", guardianXOnly, recoveryKeyXOnly,
      recoveryProfile: MAINNET1, feeScript,
    });
    // The profile guard passes; the (empty) PSBT then fails a later structural check.
    if (!r.ok) expect(r.reason).not.toBe("MAINNET_PROFILE_REQUIRED");
  });
});
