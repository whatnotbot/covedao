import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { s0StateV2 } from "@crclaunch/cove-covenant";
import {
  buildRecoveryDraft,
  signRecoverySighash,
  addRecoverySignature,
  finalizeRecovery,
} from "./recovery.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function priv(byte: number): string {
  return Buffer.alloc(32, byte).toString("hex");
}
function xonly(byte: number): Buffer {
  const k = ECPair.fromPrivateKey(Buffer.alloc(32, byte));
  return Buffer.from(k.publicKey.subarray(1));
}

const K1 = xonly(0x51);
const K2 = xonly(0x52);
const K3 = xonly(0x53);

function draft() {
  return buildRecoveryDraft({
    state: s0StateV2({ tokenId: "ab".repeat(32) }),
    guardianXOnly: xonly(0x42),
    recoveryProfile: { profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1", recoveryCsvBlocks: 2016, recoveryThreshold: 2, recoveryPubkeys: [K1, K2, K3] },
    outpoint: { txid: "cd".repeat(32), vout: 1 },
    vaultValueSats: 100_000n,
    destinationScript: bitcoin.payments.p2wpkh({ pubkey: ECPair.fromPrivateKey(Buffer.alloc(32, 0x77)).publicKey, network: bitcoin.networks.regtest }).output!,
    minerFeeSats: 1_000n,
    maxMinerFeeSats: 5_000n,
  });
}

describe("offline recovery tool (§8/§9)", () => {
  it("reconstructs the exact MAINNET1 vault from profile + state", () => {
    const d = draft();
    expect(d.vault.recoveryLeaf.script).toBeTruthy();
    expect(d.vault.recoveryLeaf.script.length).toBeGreaterThan(10);
    expect(d.threshold).toBe(2);
    expect(d.pubkeys).toHaveLength(3);
  });

  it("rejects a below-threshold finalization and a bad signature", () => {
    const d = draft();
    expect(() => finalizeRecovery(d)).toThrow(/threshold not met/);
    const sig = signRecoverySighash(d.sighash, priv(0x51));
    // wrong key (0x59 not in set)
    expect(() => addRecoverySignature(d, xonly(0x59), sig)).toThrow(/committed recovery key/);
    // corrupted signature
    const bad = Buffer.from(sig); bad[0] = (bad[0] ?? 0) ^ 0xff;
    expect(() => addRecoverySignature(d, K1, bad)).toThrow(/invalid recovery signature/);
  });

  it("finalizes exactly at 2-of-3 with a correct witness", () => {
    const d = draft();
    const s1 = signRecoverySighash(d.sighash, priv(0x51));
    const s2 = signRecoverySighash(d.sighash, priv(0x52));
    addRecoverySignature(d, K1, s1);
    addRecoverySignature(d, K2, s2);
    const hex = finalizeRecovery(d);
    const tx = bitcoin.Transaction.fromHex(hex);
    expect(tx.ins[0]!.sequence).toBe(2016);
    const w = tx.ins[0]!.witness;
    // witness = 3 sig slots (2 non-empty) + script + control block = 5 items
    expect(w.length).toBe(5);
    const sigSlots = w.slice(0, 3);
    expect(sigSlots.filter((s) => s.length === 64)).toHaveLength(2);
    expect(sigSlots.filter((s) => s.length === 0)).toHaveLength(1);
    // payout = vaultValue - minerFee
    expect(tx.outs[0]!.value).toBe(99_000);
  });

  it("enforces the miner-fee cap and rejects non-positive payout", () => {
    expect(() =>
      buildRecoveryDraft({
        state: s0StateV2({ tokenId: "ab".repeat(32) }),
        guardianXOnly: xonly(0x42),
        recoveryProfile: { profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1", recoveryCsvBlocks: 2016, recoveryThreshold: 2, recoveryPubkeys: [K1, K2, K3] },
        outpoint: { txid: "cd".repeat(32), vout: 1 },
        vaultValueSats: 100_000n,
        destinationScript: Buffer.from("0014" + "00".repeat(20), "hex"),
        minerFeeSats: 10_000n,
        maxMinerFeeSats: 5_000n,
      }),
    ).toThrow(/fee exceeds policy cap/);
  });
});
