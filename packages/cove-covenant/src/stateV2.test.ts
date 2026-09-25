import { describe, expect, it } from "vitest";
import {
  COVE_STATE_V2_BYTES,
  deserializeStateV2,
  serializeStateV2,
  stateHashV2,
  type CoveStateV2,
} from "./stateV2.js";

const S0: CoveStateV2 = {
  stateVersion: 2,
  policyVersion: 3,
  tokenId: "ab".repeat(32),
  issuedPublicSupplyAtoms: 0n,
  backingSats: 0n,
  curveStage: 1,
};

describe("CoveStateV2 (§6)", () => {
  it("fixed 51-byte serialization (golden S0)", () => {
    expect(COVE_STATE_V2_BYTES).toBe(51);
    expect(Buffer.from(serializeStateV2(S0)).toString("hex")).toBe(
      "0203" + "ab".repeat(32) + "0000000000000000" + "0000000000000000" + "01",
    );
  });

  it("S0 hash golden (domain Cove/State/v2)", () => {
    expect(stateHashV2(S0)).toBe(
      "b924c4cde29a4af73150f308372f2ac30d238226ca803a0a4bc6783c2a68ac57",
    );
  });

  it("roundtrip serialize/deserialize", () => {
    const s: CoveStateV2 = {
      stateVersion: 2,
      policyVersion: 3,
      tokenId: "cd".repeat(32),
      issuedPublicSupplyAtoms: 100_000n * 100_000_000n,
      backingSats: 869_200n,
      curveStage: 2,
    };
    expect(deserializeStateV2(serializeStateV2(s))).toEqual(s);
  });

  it("rejects nonzero supply/backing invariant violations on serialize", () => {
    expect(() =>
      serializeStateV2({ ...S0, issuedPublicSupplyAtoms: 21_000_001n * 100_000_000n }),
    ).toThrow(/out of range/);
    expect(() => serializeStateV2({ ...S0, tokenId: "00".repeat(32) })).toThrow(/nonzero/);
  });

  it("deserialize rejects wrong size / wrong version", () => {
    expect(() => deserializeStateV2(Buffer.alloc(50))).toThrow(/51/);
    expect(() => deserializeStateV2(Buffer.from([1, ...Buffer.alloc(50)]))).toThrow(/stateVersion/);
  });

  it("has no GRADUATED/LIQUIDITY phase (dropped from V2)", () => {
    // The V2 state type has no `phase` field; a token lives in backing state forever.
    expect("phase" in S0).toBe(false);
  });
});
