import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { COVE_NUMS_X_ONLY, numsInternalKey } from "./nums.js";
import {
  COVE_POLICY_CMRS,
  COVE_POLICY_V1,
  COVE_POLICY_V2,
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
const S1_HASH = Buffer.from(
  "27fb483afe745a89ea8d5f55ecc9401e0a96b15abd2ecb7ea4afb6633482828a",
  "hex",
);
const CMR = Buffer.from("118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2", "hex");

function policyIdentity(): Buffer {
  return policyIdentityHash({
    version: 1,
    operation: 3,
    tokenId: "ab".repeat(32),
    successorStateHash: S1_HASH,
    cmr: CMR,
  });
}

function build(): ReturnType<typeof buildCoveVault> {
  return buildCoveVault({
    policyIdentityHash: policyIdentity(),
    guardianXOnly: GUARDIAN,
    ownerXOnly: OWNER,
  });
}

describe("Cove NUMS/dual-leaf vault — golden vectors (CMR-bound execution)", () => {
  it("NUMS internal key is the BIP341 nothing-up-my-sleeve point", () => {
    expect(COVE_NUMS_X_ONLY).toBe(
      "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
    );
    expect(numsInternalKey().toString("hex")).toBe(COVE_NUMS_X_ONLY);
  });

  it("policy identity hash (golden) commits version+op+tokenId+state+CMR", () => {
    expect(policyIdentity().toString("hex")).toBe(
      "8728b0c360dbcb66f5df315c1f859fc5c5d4e9b28a42738fb8c775ecf104dbc1",
    );
  });

  it("execution leaf script (golden) = <policyIdentity> OP_EQUALVERIFY <guardian> OP_CHECKSIG", () => {
    expect(buildExecutionLeaf(policyIdentity(), GUARDIAN).toString("hex")).toBe(
      "208728b0c360dbcb66f5df315c1f859fc5c5d4e9b28a42738fb8c775ecf104dbc188" +
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
      "d77a167e13564710ed2e5e6a758442f7f7ed0b646f8965e6a59b474699b8230c",
    );
    expect(v.recoveryLeaf.tapleafHash.toString("hex")).toBe(
      "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.merkleRoot.toString("hex")).toBe(
      "79de452a46bfd2e8ab8b86f1f26779586fbed6a01bab672bd739e7e7e9bdcd74",
    );
    expect(v.outputKey.toString("hex")).toBe(
      "e59c39d81fc2469c2bff2d969f0ad8f7affeca20c84bdbb4a9f66632a0dc3f78",
    );
    expect(v.outputParity).toBe(0);
    expect(v.scriptPubKey.toString("hex")).toBe(
      "5120e59c39d81fc2469c2bff2d969f0ad8f7affeca20c84bdbb4a9f66632a0dc3f78",
    );
    expect(v.address).toBe("bcrt1pukwrnkqlcfrfc2ll9ktf7zkc77hlaj3qep9ahd9f7enr9gxu8auq2ls5d4");
  });

  it("control blocks commit NUMS + sibling tapleaf (golden)", () => {
    const v = build();
    expect(v.executionControlBlock.toString("hex")).toBe(
      "c0" + COVE_NUMS_X_ONLY + "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.recoveryControlBlock.toString("hex")).toBe(
      "c0" + COVE_NUMS_X_ONLY + "d77a167e13564710ed2e5e6a758442f7f7ed0b646f8965e6a59b474699b8230c",
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
        version: 1,
        operation: 3,
        tokenId: "ab".repeat(32),
        successorStateHash: S1_HASH,
        cmr: Buffer.alloc(32, 0xee),
      }),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(v2.outputKey.equals(v.outputKey)).toBe(false);
    expect(v2.address).not.toBe(v.address);
  });
});

describe("policy versioning (COVE_POLICY_V1 vs V2)", () => {
  it("V1 has only MINT CMR; V2 adds the frozen REDEEM CMR", () => {
    expect(COVE_POLICY_CMRS[COVE_POLICY_V1]).toEqual({
      mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
    });
    expect(COVE_POLICY_CMRS[COVE_POLICY_V2]).toEqual({
      mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
      redeem: "a15ac4cbc450ac2dd113b1a9de178450ccc893a5213d8a2f56471fcd9aa274b7",
    });
  });

  it("REDEEM policy identity golden (op 0x04, V2 redeem CMR)", () => {
    const redeemCmr = Buffer.from(COVE_POLICY_CMRS[COVE_POLICY_V2]!.redeem!, "hex");
    const pi = policyIdentityHash({
      version: COVE_POLICY_V2,
      operation: OP_REDEEM,
      tokenId: "ab".repeat(32),
      successorStateHash: S1_HASH,
      cmr: redeemCmr,
    });
    expect(pi.toString("hex")).toBe(
      "9f66b119776c5b52c4b6141f48c0efbb77d88a4188b3b33d77d2c9e52b81b66b",
    );
    // Different from the MINT policy identity (op 0x03).
    expect(pi.toString("hex")).not.toBe(
      "8728b0c360dbcb66f5df315c1f859fc5c5d4e9b28a42738fb8c775ecf104dbc1",
    );
  });
});
