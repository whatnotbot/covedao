import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { COVE_NUMS_X_ONLY, numsInternalKey } from "./nums.js";
import {
  COVE_POLICY_CMRS,
  COVE_POLICY_V3,
  OP_MINT,
  OP_REDEEM,
  policyIdentityHash,
} from "./policyIdentity.js";
import { buildCoveVaultV3 } from "./vault.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

function xonlyOfPriv(byte: number): Buffer {
  const sk = Buffer.alloc(32, byte);
  const pub = ecc.pointFromScalar(sk, true)!;
  return Buffer.from(pub.subarray(1));
}

const GUARDIAN = xonlyOfPriv(0x42);
const OWNER = xonlyOfPriv(0x43);
const S0_HASH = Buffer.from(
  "e27d7047a2a2f05a3f7ac319e12207c11487b59dcb212402785c129b85c518e2",
  "hex",
);
const MINT_V3 = Buffer.from(COVE_POLICY_CMRS[COVE_POLICY_V3]!.mint, "hex");
const REDEEM_V3 = Buffer.from(COVE_POLICY_CMRS[COVE_POLICY_V3]!.redeem!, "hex");

function mintPi(tokenId = "ab".repeat(32), state = S0_HASH): Buffer {
  return policyIdentityHash({
    version: 3,
    operation: OP_MINT,
    tokenId,
    currentStateHash: state,
    cmr: MINT_V3,
  });
}
function redeemPi(tokenId = "ab".repeat(32), state = S0_HASH): Buffer {
  return policyIdentityHash({
    version: 3,
    operation: OP_REDEEM,
    tokenId,
    currentStateHash: state,
    cmr: REDEEM_V3,
  });
}
function build() {
  return buildCoveVaultV3({
    mintPolicyIdentityHash: mintPi(),
    redeemPolicyIdentityHash: redeemPi(),
    guardianXOnly: GUARDIAN,
    ownerXOnly: OWNER,
  });
}

describe("Cove V3 dual-op MAST — golden vectors (§5)", () => {
  it("MINT/REDEEM policy identities (V3, current S0)", () => {
    expect(mintPi().toString("hex")).toBe(
      "03e74071a7846ae8e0d52743589cf68387d61eeacbc2d1da163f8bd40cd6b60c",
    );
    expect(redeemPi().toString("hex")).toBe(
      "c2d8198992fb068488b509b4538b67eecb01dde2eaf076d43031201e3e5a55e9",
    );
  });

  it("3-leaf merkle root + output key + address (golden)", () => {
    const v = build();
    expect(v.mintLeaf.tapleafHash.toString("hex")).toBe(
      "8a1b2fc34783de9ea5cb78de339e41caeca338e89b80a7c4d9a8ff1fdb5fb835",
    );
    expect(v.redeemLeaf.tapleafHash.toString("hex")).toBe(
      "d2f9528c18645d5b0015027ff328f22efddcc3615c525bba7577c5f39c17eb68",
    );
    expect(v.recoveryLeaf.tapleafHash.toString("hex")).toBe(
      "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.merkleRoot.toString("hex")).toBe(
      "db9d89a287b59c7413afb4062420fa9a396757a28d2f43a3afdee91ab4b559bb",
    );
    expect(v.outputKey.toString("hex")).toBe(
      "5ee8ec4f1fd433dfb52641a6a1503101bc61c153f4242b7e4ce8db88c9cb7be7",
    );
    expect(v.outputParity).toBe(0);
    expect(v.scriptPubKey.toString("hex")).toBe(
      "51205ee8ec4f1fd433dfb52641a6a1503101bc61c153f4242b7e4ce8db88c9cb7be7",
    );
    expect(v.address).toBe("bcrt1ptm5wcncl6sealdfxgxn2z5p3qx7xrs2n7sjzkljvardc3jwt00nsrztahn");
  });

  it("control blocks commit NUMS + correct merkle paths (golden)", () => {
    const v = build();
    const prefix = "c0" + COVE_NUMS_X_ONLY;
    expect(v.mintControlBlock.toString("hex")).toBe(
      prefix +
        "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998" +
        "d2f9528c18645d5b0015027ff328f22efddcc3615c525bba7577c5f39c17eb68",
    );
    expect(v.redeemControlBlock.toString("hex")).toBe(
      prefix + "9120ffd085e832e22d3b1a6b9ed3f5b19c8851607809bc3cf4c24c4798823dfe",
    );
    expect(v.recoveryControlBlock.toString("hex")).toBe(
      prefix +
        "8a1b2fc34783de9ea5cb78de339e41caeca338e89b80a7c4d9a8ff1fdb5fb835" +
        "d2f9528c18645d5b0015027ff328f22efddcc3615c525bba7577c5f39c17eb68",
    );
  });

  it("output key derived solely from NUMS + 3-leaf tree (no key-path)", () => {
    const v = build();
    expect(v.outputKey.toString("hex")).not.toBe(numsInternalKey().toString("hex"));
  });
});

describe("V3 vault determinism / separation", () => {
  it("same state+policy ⇒ same key; different state ⇒ different key", () => {
    expect(build().outputKey.equals(build().outputKey)).toBe(true);
    const v2 = buildCoveVaultV3({
      mintPolicyIdentityHash: mintPi("ab".repeat(32), Buffer.alloc(32, 0x11)),
      redeemPolicyIdentityHash: redeemPi(),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(v2.outputKey.equals(build().outputKey)).toBe(false);
  });

  it("different tokenId ⇒ different key", () => {
    const v2 = buildCoveVaultV3({
      mintPolicyIdentityHash: mintPi("cd".repeat(32)),
      redeemPolicyIdentityHash: redeemPi("cd".repeat(32)),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(v2.outputKey.equals(build().outputKey)).toBe(false);
  });

  it("different MINT CMR ⇒ different key; different REDEEM CMR ⇒ different key", () => {
    const altMint = buildCoveVaultV3({
      mintPolicyIdentityHash: policyIdentityHash({
        version: 3,
        operation: OP_MINT,
        tokenId: "ab".repeat(32),
        currentStateHash: S0_HASH,
        cmr: Buffer.alloc(32, 0x11),
      }),
      redeemPolicyIdentityHash: redeemPi(),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(altMint.outputKey.equals(build().outputKey)).toBe(false);

    const altRedeem = buildCoveVaultV3({
      mintPolicyIdentityHash: mintPi(),
      redeemPolicyIdentityHash: policyIdentityHash({
        version: 3,
        operation: OP_REDEEM,
        tokenId: "ab".repeat(32),
        currentStateHash: S0_HASH,
        cmr: Buffer.alloc(32, 0x22),
      }),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(altRedeem.outputKey.equals(build().outputKey)).toBe(false);
  });

  it("MINT and REDEEM leaves are distinct (cannot be confused)", () => {
    const v = build();
    expect(v.mintLeaf.tapleafHash.equals(v.redeemLeaf.tapleafHash)).toBe(false);
    expect(v.mintLeaf.script.equals(v.redeemLeaf.script)).toBe(false);
  });
});
