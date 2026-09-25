import { describe, expect, it } from "vitest";
import { COVE_STATE_BYTES, deserializeState, serializeState, stateHash } from "./state.js";

const S0 = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT" as const,
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

describe("CoveState fixed-width encoding", () => {
  it("is exactly 51 bytes", () => {
    expect(serializeState(S0).length).toBe(COVE_STATE_BYTES);
  });

  it("round-trips through serialize/deserialize", () => {
    expect(deserializeState(serializeState(S0))).toEqual(S0);
  });

  it("rejects a wrong tokenId length", () => {
    expect(() => serializeState({ ...S0, tokenId: "ab" })).toThrow(/64 hex/);
  });

  it("rejects a non-u64 public supply", () => {
    expect(() => serializeState({ ...S0, publicSupplyAtoms: 2n ** 64n })).toThrow(/u64/);
  });

  it("rejects an out-of-range curve stage", () => {
    expect(() => serializeState({ ...S0, curveStage: 21 })).toThrow(/1\.\.20/);
  });
});

describe("CoveState domain-separated hash", () => {
  it("is domain-separated (different domain would differ)", () => {
    // The hash commits to the "Cove/State/v1" domain; any change to the state
    // bytes changes the digest.
    const a = stateHash(S0);
    const b = stateHash({ ...S0, reserveSats: 1n });
    expect(a).not.toBe(b);
  });

  it("S0 != S1 ⇒ different hash", () => {
    const S1 = {
      ...S0,
      publicSupplyAtoms: 50_000_000n * 100_000_000n,
      reserveSats: 25_000n,
      curveStage: 2,
    };
    expect(stateHash(S1)).not.toBe(stateHash(S0));
  });

  it("golden: S0 serialization and hash", () => {
    expect(Buffer.from(serializeState(S0)).toString("hex")).toBe(
      "01" + "ab".repeat(32) + "00" + "0000000000000000" + "0000000000000000" + "01",
    );
    expect(stateHash(S0)).toBe("e27d7047a2a2f05a3f7ac319e12207c11487b59dcb212402785c129b85c518e2");
  });

  it("golden: S1 (after minting 50M) serialization and hash", () => {
    const S1 = {
      ...S0,
      publicSupplyAtoms: 50_000_000n * 100_000_000n,
      reserveSats: 25_000n,
      curveStage: 2,
    };
    expect(Buffer.from(serializeState(S1)).toString("hex")).toBe(
      "01" + "ab".repeat(32) + "00" + "0011c37937e08000" + "00000000000061a8" + "02",
    );
    expect(stateHash(S1)).toBe("241813cd83d8fc44a8abed841f0bd09fc87ba0c2c0e5a698b7470b6515c845e3");
  });
});
