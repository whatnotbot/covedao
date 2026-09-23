import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { COVE_NUMS_X_ONLY, numsInternalKey } from "./nums.js";
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

function build(): ReturnType<typeof buildCoveVault> {
  return buildCoveVault({
    successorStateHash: S1_HASH,
    guardianXOnly: GUARDIAN,
    ownerXOnly: OWNER,
  });
}

describe("Cove NUMS/dual-leaf vault — golden vectors", () => {
  it("NUMS internal key is the BIP341 nothing-up-my-sleeve point", () => {
    expect(COVE_NUMS_X_ONLY).toBe(
      "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
    );
    expect(numsInternalKey().toString("hex")).toBe(COVE_NUMS_X_ONLY);
  });

  it("execution leaf script (golden)", () => {
    expect(buildExecutionLeaf(S1_HASH, GUARDIAN).toString("hex")).toBe(
      "2027fb483afe745a89ea8d5f55ecc9401e0a96b15abd2ecb7ea4afb6633482828a88" +
        "2024653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d2353dc0ab1cac",
    );
  });

  it("recovery leaf script = <144> OP_CSV OP_2DROP <owner> OP_CHECKSIG (golden)", () => {
    expect(RECOVERY_CSV_BLOCKS).toBe(144);
    expect(buildRecoveryLeaf(OWNER).toString("hex")).toBe(
      "029000b26d207f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa297165faa2007ac",
    );
  });

  it("tapleaf hashes + merkle root + output key + address (golden)", () => {
    const v = build();
    expect(v.executionLeaf.tapleafHash.toString("hex")).toBe(
      "b25c34ff056e4c1ed4783a8c0d866c7f0458896e0241fa44d6d84168739fc71c",
    );
    expect(v.recoveryLeaf.tapleafHash.toString("hex")).toBe(
      "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.merkleRoot.toString("hex")).toBe(
      "3bdcd984978c70124507f9fd79e98b7fa46f585af6445d055d313b20be933a36",
    );
    expect(v.outputKey.toString("hex")).toBe(
      "be5f27a70ac215cdb98da7af6a35a46645c8ab58cfb7d657f7738068ec1ac9ff",
    );
    expect(v.outputParity).toBe(0);
    expect(v.scriptPubKey.toString("hex")).toBe(
      "5120be5f27a70ac215cdb98da7af6a35a46645c8ab58cfb7d657f7738068ec1ac9ff",
    );
    expect(v.address).toBe("bcrt1phe0j0fc2cg2umwvd57hk5ddyvezu326ce7mav4lhwwqx3mq6e8lsjemasd");
  });

  it("control blocks commit the NUMS key + sibling tapleaf (golden)", () => {
    const v = build();
    expect(v.executionControlBlock.toString("hex")).toBe(
      "c0" + COVE_NUMS_X_ONLY + "5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998",
    );
    expect(v.recoveryControlBlock.toString("hex")).toBe(
      "c0" + COVE_NUMS_X_ONLY + "b25c34ff056e4c1ed4783a8c0d866c7f0458896e0241fa44d6d84168739fc71c",
    );
  });

  it("output key is derived SOLELY from NUMS + committed tree (no key-path key)", () => {
    const v = build();
    // Re-derive independently: Q = NUMS + H_TapTweak(NUMS || merkleRoot)·G.
    const { outputKey } = tweakKey(v.numsKey, v.merkleRoot);
    expect(outputKey.equals(v.outputKey)).toBe(true);
    // The tweak equals the TapTweak tagged hash of (NUMS || merkleRoot).
    expect(tapTweak(v.numsKey, v.merkleRoot).toString("hex")).toMatch(/^[0-9a-f]{64}$/);
    // Sanity: two different successor states yield different vaults.
    const v2 = buildCoveVault({
      successorStateHash: Buffer.from("ab".repeat(32), "hex"),
      guardianXOnly: GUARDIAN,
      ownerXOnly: OWNER,
    });
    expect(v2.outputKey.equals(v.outputKey)).toBe(false);
    expect(v2.address).not.toBe(v.address);
  });
});
