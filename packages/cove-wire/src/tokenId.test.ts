import { describe, expect, it } from "vitest";
import {
  CHAIN_BITCOIN_MAINNET,
  CHAIN_BITCOIN_REGTEST,
  canonicalTicker,
  computeTokenId,
  tokenIdHex,
} from "./tokenId.js";

const NONCE = Buffer.alloc(32, 0xab);
const CREATOR = Buffer.from("0014" + "11".repeat(20), "hex");

describe("precomputable token identity (§4)", () => {
  it("golden tokenId (deterministic)", () => {
    expect(
      tokenIdHex({
        chainIdentity: CHAIN_BITCOIN_REGTEST,
        policyVersion: 3,
        ticker: "FROG",
        tokenNonce: NONCE,
        creatorScript: CREATOR,
      }),
    ).toBe("baced61fec0446c946fdd97439d62e2cb84e19b422e8dd95c66da7e033ba5600");
  });

  it("tokenId is 32 bytes", () => {
    expect(
      computeTokenId({
        chainIdentity: CHAIN_BITCOIN_REGTEST,
        policyVersion: 3,
        ticker: "FROG",
        tokenNonce: NONCE,
        creatorScript: CREATOR,
      }).length,
    ).toBe(32);
  });

  it("network/domain separation: different chain ⇒ different tokenId", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_MAINNET,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    expect(a).not.toBe(b);
  });

  it("policyVersion separation", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 2,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    expect(a).not.toBe(b);
  });

  it("nonce separation", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: Buffer.alloc(32, 0xcd),
      creatorScript: CREATOR,
    });
    expect(a).not.toBe(b);
  });

  it("ticker is metadata: casing normalized, not identity", () => {
    const a = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
    });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "frog",
      tokenNonce: NONCE,
      creatorScript: CREATOR,
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
        creatorScript: CREATOR,
      }),
    ).toThrow(/32 bytes/);
  });

  it("creator separation: a copied DEPLOY naming another creator gets another tokenId", () => {
    const a = tokenIdHex({ chainIdentity: CHAIN_BITCOIN_REGTEST, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE, creatorScript: CREATOR });
    const b = tokenIdHex({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
      creatorScript: Buffer.from("0014" + "22".repeat(20), "hex"),
    });
    expect(a).not.toBe(b);
  });

  it("rejects an empty creator script", () => {
    expect(() =>
      computeTokenId({ chainIdentity: CHAIN_BITCOIN_REGTEST, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE, creatorScript: Buffer.alloc(0) }),
    ).toThrow(/creatorScript/);
  });
});
