import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { deriveStateOutput, stateCommitment, stateTweak } from "./taproot.js";

const internalKey = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));

const S0 = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT" as const,
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};
const S1 = {
  ...S0,
  publicSupplyAtoms: 42_000_000n * 100_000_000n,
  reserveSats: 21_000n,
  curveStage: 2,
};

describe("state-committed P2TR derivation", () => {
  it("S0 != S1 ⇒ different output key / scriptPubKey / address", () => {
    const o0 = deriveStateOutput(internalKey, S0, bitcoin.networks.regtest);
    const o1 = deriveStateOutput(internalKey, S1, bitcoin.networks.regtest);
    expect(o0.outputKey.equals(o1.outputKey)).toBe(false);
    expect(o0.scriptPubKeyHex).not.toBe(o1.scriptPubKeyHex);
    expect(o0.address).not.toBe(o1.address);
  });

  it("is deterministic for the same state", () => {
    expect(deriveStateOutput(internalKey, S0, bitcoin.networks.regtest)).toEqual(
      deriveStateOutput(internalKey, S0, bitcoin.networks.regtest),
    );
  });

  it("produces a valid P2TR scriptPubKey (0x5120 || 32-byte key)", () => {
    const o = deriveStateOutput(internalKey, S0, bitcoin.networks.regtest);
    expect(o.scriptPubKeyHex).toMatch(/^5120[0-9a-f]{64}$/);
    expect(o.outputKey.length).toBe(32);
  });

  it("golden: S0 commitment + output key + address", () => {
    expect(stateCommitment(S0).toString("hex")).toBe(
      "8f3073a649a56453aa697be0c73282023c67334f99ef6d6af5cf00b39ef46a37",
    );
    const o = deriveStateOutput(internalKey, S0, bitcoin.networks.regtest);
    expect(o.outputKey.toString("hex")).toBe(
      "e6f6455aa7751ef3f731e29e065efb09bc0400048c6db743258a505b3a68c5c7",
    );
    expect(o.scriptPubKeyHex).toBe(
      "5120e6f6455aa7751ef3f731e29e065efb09bc0400048c6db743258a505b3a68c5c7",
    );
    expect(o.address).toBe("bcrt1pummy2k48w5008ae3u20qvhhmpx7qgqqy33kmwse93fg9kwngchrs42nxf5");
  });

  it("golden: S1 output key + address", () => {
    const o = deriveStateOutput(internalKey, S1, bitcoin.networks.regtest);
    expect(o.outputKey.toString("hex")).toBe(
      "d15aa47b989f9cb170f86e4a274626d804943d8df0b88ab73b0dd39aa8c087a0",
    );
    expect(o.address).toBe("bcrt1p69d2g7ucn7wtzu8cde9zw33xmqzfg0vd7zug4demphfe42xqs7sqd6uej6");
  });

  it("stateTweak: golden TapTweak scalar and Q = P + tweak·G", () => {
    const tweak = stateTweak(internalKey, S0);
    expect(tweak.toString("hex")).toBe(
      "c0f0b9ab8438902b78f19bcc1d7a4bba53f0677d8ffb56f5db83dc143521c435",
    );
    expect(tweak.length).toBe(32);
    const q = ecc.xOnlyPointAddTweak(internalKey, tweak)!;
    expect(Buffer.from(q.xOnlyPubkey).toString("hex")).toBe(
      deriveStateOutput(internalKey, S0, bitcoin.networks.regtest).outputKey.toString("hex"),
    );
  });
});
