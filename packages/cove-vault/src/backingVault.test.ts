import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { s0StateV2, applyMintV2 } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "./backingVault.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

function xonlyOfPriv(byte: number): Buffer {
  return Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, byte), true)!.subarray(1));
}
const GUARDIAN = xonlyOfPriv(0x42);
const RECOVERY = xonlyOfPriv(0x43);
const ATOMS = 100_000_000n;

function build(state = s0StateV2({ tokenId: "cd".repeat(32) })) {
  return buildBackingVaultV3({ state, guardianXOnly: GUARDIAN, recoveryKeyXOnly: RECOVERY });
}

describe("buildBackingVaultV3 (§6)", () => {
  it("derives MINT/REDEEM identities from state (deterministic)", () => {
    const a = build();
    const b = build();
    expect(a.outputKey.equals(b.outputKey)).toBe(true);
    expect(a.address).toBe(b.address);
  });

  it("current state mutation changes vault", () => {
    const s0 = s0StateV2({ tokenId: "cd".repeat(32) });
    const s1 = applyMintV2(s0, 100_000n * ATOMS).nextState;
    expect(build(s1).outputKey.equals(build(s0).outputKey)).toBe(false);
  });

  it("supply/backing mutation changes vault", () => {
    const s0 = s0StateV2({ tokenId: "cd".repeat(32) });
    const s2 = {
      ...s0,
      issuedPublicSupplyAtoms: 100_000n * ATOMS,
      backingSats: 869_200n,
      curveStage: 2,
    };
    expect(build(s2).outputKey.equals(build(s0).outputKey)).toBe(false);
  });

  it("token mutation changes vault", () => {
    expect(
      build(s0StateV2({ tokenId: "aa".repeat(32) })).outputKey.equals(
        build(s0StateV2({ tokenId: "cd".repeat(32) })).outputKey,
      ),
    ).toBe(false);
  });

  it("MINT leaf != REDEEM leaf (op separation)", () => {
    const v = build();
    expect(v.mintLeaf.tapleafHash.equals(v.redeemLeaf.tapleafHash)).toBe(false);
  });
});
