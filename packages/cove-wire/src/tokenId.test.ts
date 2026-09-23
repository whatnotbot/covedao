import { describe, expect, it } from "vitest";
import {
  CHAIN_BITCOIN_MAINNET,
  CHAIN_BITCOIN_REGTEST,
  canonicalTicker,
  computeTokenId,
  tokenIdHex,
} from "./tokenId.js";

const NONCE = Buffer.alloc(32, 0xab);

describe("precomputable token identity (§4)", () => {
  it("golden tokenId (deterministic)", () => {
    expect(
      tokenIdHex({
        chainIdentity: CHAIN_BITCOIN_REGTEST,
        policyVersion: 3,
        ticker: "FROG",
        tokenNonce: NONCE,
      }),
    ).toBe("4710488a0ab304fb2316e0174360a41937e1f0a81f2b26dee5a38ef79fb2d252");
  });

  it("tokenId is 32 bytes", () => {
    expect(
      computeTokenId({
        chainIdentity: CHAIN_BITCOIN_REGTEST,
        policyVersion: 3,
        ticker: "FROG",
        tokenNonce: NONCE,
      }).length,
    ).toBe(32);
  });

  it("network/domain separation: different chain ⇒ different tokenId", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_MAINNET,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    expect(a).not.toBe(b);
  });

  it("policyVersion separation", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 2,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    expect(a).not.toBe(b);
  });

  it("nonce separation", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: Buffer.alloc(32, 0xcd),
    });
    expect(a).not.toBe(b);
  });

  it("ticker is metadata: casing normalized, not identity", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "frog",
      tokenNonce: NONCE,
    });
    expect(a).toBe(b);
    expect(canonicalTicker("frog")).toBe("FROG");
  });

  it("malformed ticker / nonce rejected", () => {
    expect(() => canonicalTicker("")).toThrow();
    expect(() => canonicalTicker("x".repeat(17))).toThrow();
    expect(() => canonicalTicker("FROG!")).toThrow();
    expect(() =>
      computeTokenId({
        chainIdentity: "x",
        policyVersion: 3,
        ticker: "FROG",
        tokenNonce: Buffer.alloc(31),
      }),
    ).toThrow(/32 bytes/);
  });
});
