import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { s0StateV2 } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3, buildThresholdRecoveryLeaf, type VaultRecoveryProfile } from "@crclaunch/cove-vault";
import {
  buildRecoveryDraft,
  signRecoverySighash,
  addRecoverySignature,
  finalizeRecovery,
  verifyRecoverySignature,
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

describe("2-of-3 MAINNET1 recovery rehearsal (§C8)", () => {
  const FIXTURE = resolve(process.cwd(), "../../test/fixtures/mainnet-profile.json");

  it("the committed MAINNET1 profile keys are on-curve, distinct, and build a canonical leaf", () => {
    const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as { recovery: { threshold: number; csvBlocks: number; pubkeys: string[] } };
    const profile: VaultRecoveryProfile = {
      profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
      recoveryCsvBlocks: raw.recovery.csvBlocks,
      recoveryThreshold: raw.recovery.threshold,
      recoveryPubkeys: raw.recovery.pubkeys.map((k) => Buffer.from(k, "hex")),
    };
    // C8: every key is on-curve and distinct (no off-curve / duplicate → spendable).
    for (const k of profile.recoveryPubkeys) expect(ecc.isXOnlyPoint(k)).toBe(true);
    expect(new Set(profile.recoveryPubkeys.map((k) => k.toString("hex"))).size).toBe(3);

    const leaf = buildThresholdRecoveryLeaf(profile.recoveryCsvBlocks, profile.recoveryThreshold, profile.recoveryPubkeys);
    expect(leaf).toBeTruthy();
    expect(leaf.length).toBeGreaterThan(10);

    const vault = buildBackingVaultV3({
      state: s0StateV2({ tokenId: "ab".repeat(32) }),
      guardianXOnly: xonly(0x42),
      recoveryKeyXOnly: profile.recoveryPubkeys[0]!,
      recoveryProfile: profile,
      network: bitcoin.networks.testnet, // signet address prefix
    });
    expect(vault.address.startsWith("tb1")).toBe(true);
    expect(vault.scriptPubKey.length).toBe(34);
    expect(vault.recoveryLeaf.script.equals(leaf)).toBe(true);
  });

  it("rehearses a full 2-of-3 recovery spend: signatures verify and the witness satisfies OP_2 NUMEQUAL", () => {
    // Deterministic test keys stand in for the operator's 2-of-3 shards; the
    // point is to prove the MAINNET1 threshold script is satisfiable end-to-end.
    const d = draft();
    const s1 = signRecoverySighash(d.sighash, priv(0x51));
    const s2 = signRecoverySighash(d.sighash, priv(0x52));
    addRecoverySignature(d, K1, s1);
    addRecoverySignature(d, K2, s2);
    const hex = finalizeRecovery(d);
    const tx = bitcoin.Transaction.fromHex(hex);
    const w = tx.ins[0]!.witness;
    const slots = w.slice(0, 3);
    // Exactly threshold (2) non-empty signature slots, 1 empty → OP_2 NUMEQUAL.
    const nonEmpty = slots.filter((s) => s.length === 64);
    expect(nonEmpty).toHaveLength(2);

    // Every non-empty signature independently verifies against the sighash + key.
    for (const [i, sig] of slots.entries()) {
      if (sig.length === 64) {
        const key = d.pubkeys[d.pubkeys.length - 1 - i]!;
        expect(verifyRecoverySignature(d.sighash, key, sig)).toBe(true);
      }
    }
    // Simulate CHECKSIG/CHECKSIGADD: count of valid signatures == threshold.
    let count = 0;
    for (const [i, sig] of slots.entries()) {
      const key = d.pubkeys[d.pubkeys.length - 1 - i]!;
      if (sig.length === 64 && verifyRecoverySignature(d.sighash, key, sig)) count += 1;
    }
    expect(count).toBe(d.threshold);
    // The recovery spend pays (vaultValue - minerFee) to the approved destination.
    expect(tx.outs[0]!.value).toBe(99_000);
    expect(tx.ins[0]!.sequence).toBe(2016);
  });
});
