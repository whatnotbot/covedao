import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { COVE_NUMS_X_ONLY, numsInternalKey } from "./nums.js";
import {
  COVE_POLICY_CMRS,
  COVE_POLICY_V1,
  COVE_POLICY_V2,
  COVE_POLICY_V3,
  OP_MINT,
  OP_REDEEM,
  policyIdentityHash,
} from "./policyIdentity.js";
import { RECOVERY_CSV_BLOCKS, buildExecutionLeaf, buildRecoveryLeaf } from "./leaves.js";
import { buildCoveVault } from "./vault.js";
import { tapTweak, tweakKey } from "./taproot.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

function xonlyOfPriv(byte: number): Buffer {
  const sk = Buffer.alloc(32, byte);
  const pub = ecc.pointFromScalar(sk, true)!;
  return Buffer.from(pub.subarray(1));
}

const GUARDIAN = xonlyOfPriv(0x42);
const OWNER = xonlyOfPriv(0x43);
// CURRENT state (S0), NOT a future successor (§3 fix).
const S0_HASH = Buffer.from(
  "e27d7047a2a2f05a3f7ac319e12207c11487b59dcb212402785c129b85c518e2",
  "hex",
);
const MINT_V3_CMR = Buffer.from(COVE_POLICY_CMRS[COVE_POLICY_V3]!.mint, "hex");

function mintPolicyIdentity(): Buffer {
  return policyIdentityHash({
    version: COVE_POLICY_V3,
    operation: OP_MINT,
    tokenId: "ab".repeat(32),
    currentStateHash: S0_HASH,
    cmr: MINT_V3_CMR,
  });
}

function build(): ReturnType<typeof buildCoveVault> {
  return buildCoveVault({
    policyIdentityHash: mintPolicyIdentity(),
    guardianXOnly: GUARDIAN,
    ownerXOnly: OWNER,
  });
}

describe("Cove NUMS/dual-leaf vault — golden vectors (V3, current-state)", () => {
  it("NUMS internal key is the BIP341 nothing-up-my-sleeve point", () => {
    expect(COVE_NUMS_X_ONLY).toBe(
      "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
    );
    expect(numsInternalKey().toString("hex")).toBe(COVE_NUMS_X_ONLY);
  });

  it("MINT policy identity (V3, current S0) golden", () => {
    expect(mintPolicyIdentity().toString("hex")).toBe(
      "03e74071a7846ae8e0d52743589cf68387d61eeacbc2d1da163f8bd40cd6b60c",
    );
  });

  it("execution leaf commits CURRENT state + V3 MINT CMR (not successor)", () => {
    expect(buildExecutionLeaf(mintPolicyIdentity(), GUARDIAN).toString("hex")).toBe(
      "2003e74071a7846ae8e0d52743589cf68387d61eeacbc2d1da163f8bd40cd6b60c88" +
        "2024653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d2353dc0ab1cac",
    );
  });

  it("recovery leaf = <144> OP_CSV OP_2DROP <owner> OP_CHECKSIG (golden)", () => {
    expect(RECOVERY_CSV_BLOCKS).toBe(144);
    expect(buildRecoveryLeaf(OWNER).toString("hex")).toBe(
      "029000b26d207f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa297165faa2007ac",
    );
  });

  it("tapleaf hashes + merkle root + output key + address (golden)", () => {
    const v = build();
    expect(v.executionLeaf.tapleafHash.toString("hex")).toBe(
      "8a1b2fc34783de9ea5cb78de339e41caeca338e89b80a7c4d9a8ff1fdb5fb835",
    );
    expect(v.recoveryLeaf.tapleafHash.toString("hex")).toBe(
      "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.merkleRoot.toString("hex")).toBe(
      "9120ffd085e832e22d3b1a6b9ed3f5b19c8851607809bc3cf4c24c4798823dfe",
    );
    expect(v.outputKey.toString("hex")).toBe(
      "23ff75ac4a592a682d1cb8516490480567c39c028e9522628a16264c1886df2e",
    );
    expect(v.outputParity).toBe(1);
    expect(v.scriptPubKey.toString("hex")).toBe(
      "512023ff75ac4a592a682d1cb8516490480567c39c028e9522628a16264c1886df2e",
    );
    expect(v.address).toBe("bcrt1py0lhttz2ty4xstguhpgkfyzgq4nu88qz362jyc52zcnycxyxmuhq9ps36d");
  });

  it("control blocks commit NUMS + sibling tapleaf (golden)", () => {
    const v = build();
    expect(v.executionControlBlock.toString("hex")).toBe(
      "c1" + COVE_NUMS_X_ONLY + "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.recoveryControlBlock.toString("hex")).toBe(
      "c1" + COVE_NUMS_X_ONLY + "8a1b2fc34783de9ea5cb78de339e41caeca338e89b80a7c4d9a8ff1fdb5fb835",
    );
  });

  it("output key is derived SOLELY from NUMS + committed tree (no key-path key)", () => {
    const v = build();
    const { outputKey } = tweakKey(v.numsKey, v.merkleRoot);
    expect(outputKey.equals(v.outputKey)).toBe(true);
    expect(tapTweak(v.numsKey, v.merkleRoot).toString("hex")).toMatch(/^[0-9a-f]{64}$/);
    // Different CMR ⇒ different vault.
    const v2 = buildCoveVault({
      policyIdentityHash: policyIdentityHash({
        version: COVE_POLICY_V3,
        operation: OP_MINT,
        tokenId: "ab".repeat(32),
        currentStateHash: S0_HASH,
        cmr: Buffer.alloc(32, 0xee),
      }),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(v2.outputKey.equals(v.outputKey)).toBe(false);
  });

  it("same current state + policy ⇒ same output key; different state ⇒ different", () => {
    const a = build();
    const b = build();
    expect(a.outputKey.equals(b.outputKey)).toBe(true);
    const c = buildCoveVault({
      policyIdentityHash: policyIdentityHash({
        version: COVE_POLICY_V3,
        operation: OP_MINT,
        tokenId: "ab".repeat(32),
        currentStateHash: Buffer.alloc(32, 0x11),
        cmr: MINT_V3_CMR,
      }),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(c.outputKey.equals(a.outputKey)).toBe(false);
  });
});

describe("policy versioning (COVE_POLICY_V1/V2/V3)", () => {
  it("V1/V2 are historical; V3 is production", () => {
    expect(COVE_POLICY_CMRS[COVE_POLICY_V1]).toEqual({
      mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
    });
    expect(COVE_POLICY_CMRS[COVE_POLICY_V2]).toEqual({
      mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
      redeem: "a15ac4cbc450ac2dd113b1a9de178450ccc893a5213d8a2f56471fcd9aa274b7",
    });
    expect(COVE_POLICY_CMRS[COVE_POLICY_V3]).toEqual({
      mint: "ccdb02000fdb372bfa2e166b9fe0192715d555fc5720f8008ee741fe1a0d58ec",
      redeem: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
    });
  });

  it("REDEEM policy identity (V3) differs from MINT", () => {
    const redeemCmr = Buffer.from(COVE_POLICY_CMRS[COVE_POLICY_V3]!.redeem!, "hex");
    const mintPi = mintPolicyIdentity();
    const redeemPi = policyIdentityHash({
      version: COVE_POLICY_V3,
      operation: OP_REDEEM,
      tokenId: "ab".repeat(32),
      currentStateHash: S0_HASH,
      cmr: redeemCmr,
    });
    expect(redeemPi.equals(mintPi)).toBe(false);
    expect(redeemPi.toString("hex")).toMatch(/^[0-9a-f]{64}$/);
  });
});
