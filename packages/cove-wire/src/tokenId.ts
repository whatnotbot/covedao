import { createHash } from "node:crypto";

/**
 * Precomputable, domain-separated Cove token identity (§4).
 *
 * Previous design: tokenId = deployTxid. That is cryptographically circular
 * (the txid commits outputs, the output commits tokenId, tokenId = txid — no
 * deterministic fixed point). Production uses a PRECOMPUTABLE identity known
 * before DEPLOY transaction construction:
 *
 *   tokenId = H_CoveToken(chainIdentity || policyVersion || canonicalTicker || tokenNonce)
 *
 * - chainIdentity prevents accidental cross-network identity reuse.
 * - policyVersion is the production policy-set version.
 * - canonicalTicker is the uppercase ASCII ticker (metadata, not unique key).
 * - tokenNonce is 32 random bytes committed in the DEPLOY wire data.
 *
 * Duplicate tokenId deploy is invalid. deployTxid is stored separately.
 */

function taggedHash(tag: string, msg: Buffer): Buffer {
  const tagHash = createHash("sha256").update(tag, "utf8").digest();
  return createHash("sha256").update(tagHash).update(tagHash).update(msg).digest();
}

/** Canonical chain identity strings (uppercase network, no ambiguity). */
export const CHAIN_BITCOIN_MAINNET = "bitcoin-mainnet";
export const CHAIN_BITCOIN_REGTEST = "bitcoin-regtest";
export const CHAIN_BITCOIN_SIGNET = "bitcoin-signet";
export const CHAIN_BITCOIN_TESTNET = "bitcoin-testnet";

export interface TokenIdentityInput {
  chainIdentity: string;
  policyVersion: number;
  ticker: string;
  /** 32 random bytes committed in DEPLOY wire data. */
  tokenNonce: Buffer;
}

export function canonicalTicker(ticker: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(ticker)) {
    throw new Error("ticker must be 1..16 alphanumeric, starting with a letter");
  }
  return ticker.toUpperCase();
}

export function computeTokenId(input: TokenIdentityInput): Buffer {
  const tick = canonicalTicker(input.ticker);
  if (input.tokenNonce.length !== 32) {
    throw new Error("tokenNonce must be 32 bytes");
  }
  if (!Number.isInteger(input.policyVersion) || input.policyVersion < 1) {
    throw new Error("policyVersion must be a positive integer");
  }
  return taggedHash(
    "CoveToken",
    Buffer.concat([
      Buffer.from(input.chainIdentity, "utf8"),
      Buffer.from([input.policyVersion]),
      Buffer.from(tick, "utf8"),
      input.tokenNonce,
    ]),
  );
}

/** Hex string form (64 chars). */
export function tokenIdHex(input: TokenIdentityInput): string {
  return computeTokenId(input).toString("hex");
}
