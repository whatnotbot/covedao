import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { buildCoveVaultV3 } from "./vault.js";
import {
  buildThresholdRecoveryLeaf,
  buildThresholdRecoveryWitness,
  sortRecoveryPubkeys,
} from "./vaultProfile.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function xonly(privByte: number): Buffer {
  const k = ECPair.fromPrivateKey(Buffer.alloc(32, privByte), { network: bitcoin.networks.regtest });
  return Buffer.from(k.publicKey.subarray(1));
}

const K1 = xonly(0x51);
const K2 = xonly(0x52);
const K3 = xonly(0x53);

describe("MAINNET1 threshold recovery profile (§3-§6)", () => {
  it("freezes the 2-of-3 recovery leaf bytes", () => {
    const leaf = buildThresholdRecoveryLeaf(144, 2, [K1, K2, K3]);
    expect(leaf.toString("hex")).toMatchSnapshot();
    // structural sanity: CSV operand + CSV + DROP + 3×(key+CHECKSIG/ADD) + OP_2 + NUMEQUAL
    expect(leaf[0]).toBe(0x02); // minimal-encoded 144
    expect(leaf[1]).toBe(144);
  });

  it("orders keys lexicographically: any permutation → identical leaf", () => {
    const a = buildThresholdRecoveryLeaf(144, 2, [K1, K2, K3]).toString("hex");
    const b = buildThresholdRecoveryLeaf(144, 2, [K3, K1, K2]).toString("hex");
    const c = buildThresholdRecoveryLeaf(144, 2, [K2, K3, K1]).toString("hex");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(sortRecoveryPubkeys([K3, K1, K2])).toEqual(sortRecoveryPubkeys([K2, K1, K3]));
  });

  it("builds a deterministic MAINNET1 V3 vault", () => {
    const vault = buildCoveVaultV3({
      mintPolicyIdentityHash: Buffer.alloc(32, 0x11),
      redeemPolicyIdentityHash: Buffer.alloc(32, 0x22),
      guardianXOnly: xonly(0x42),
      ownerXOnly: K1,
      recoveryProfile: { profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1", recoveryCsvBlocks: 2016, recoveryThreshold: 2, recoveryPubkeys: [K1, K2, K3] },
      network: bitcoin.networks.regtest,
    });
    expect(vault.recoveryLeaf.script).toEqual(buildThresholdRecoveryLeaf(2016, 2, [K1, K2, K3]));
    expect(vault.scriptPubKey.length).toBe(34);
    expect(vault.address.startsWith("bcrt1")).toBe(true);
  });

  it("builds the recovery witness with one slot per sorted key (empty = absent)", () => {
    const sigs = new Map<string, Buffer>([[K1.toString("hex"), Buffer.alloc(64, 0xaa)]]);
    const w = buildThresholdRecoveryWitness({ pubkeys: [K1, K2, K3], signatures: sigs });
    expect(w.length).toBe(3);
    // Exactly one non-empty slot (the signed key); the rest are empty vectors.
    const nonEmpty = w.filter((x) => x.length === 64);
    const empty = w.filter((x) => x.length === 0);
    expect(nonEmpty.length).toBe(1);
    expect(empty.length).toBe(2);
    // The witness stack is in reverse sorted-key order (first CHECKSIG pops top).
    const sorted = sortRecoveryPubkeys([K1, K2, K3]);
    const signedIndex = sorted.findIndex((k) => k.equals(K1));
    expect(w[w.length - 1 - signedIndex]!.length).toBe(64);
  });
});
