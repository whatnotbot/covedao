import { createHash } from "node:crypto";
import { canonicalTicker } from "./ticker.js";

export { canonicalTicker };

/**
 * Precomputable, domain-separated Cove token identity (§4).
 *
 * Previous design: tokenId = deployTxid. That is cryptographically circular
 * (the txid commits outputs, the output commits tokenId, tokenId = txid — no
 * deterministic fixed point). Production uses a PRECOMPUTABLE identity known
 * before DEPLOY transaction construction:
 *
 *   tokenId = H_CoveToken(chainIdentity || policyVersion || canonicalTicker || tokenNonce
 *                         || len(creatorScript) || creatorScript)
 *
 * - chainIdentity prevents accidental cross-network identity reuse.
 * - policyVersion is the production policy-set version.
 * - canonicalTicker is the uppercase ASCII ticker (metadata, not unique key).
 * - tokenNonce is 32 random bytes committed in the DEPLOY wire data.
 * - creatorScript is the DEPLOY's output 2, where every mint pays the creator.
 *   Without it, anyone who saw a DEPLOY in the mempool could copy its ticker
 *   and nonce, name their own address as creator, pay a higher fee, and take
 *   the tokenId (a later duplicate is invalid) and every creator payment.
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
  /** The creator's payout script: the DEPLOY's output 2. */
  creatorScript: Buffer;
}

export function computeTokenId(input: TokenIdentityInput): Buffer {
  const tick = canonicalTicker(input.ticker);
  if (input.tokenNonce.length !== 32) {
    throw new Error("tokenNonce must be 32 bytes");
  }
  if (!Number.isInteger(input.policyVersion) || input.policyVersion < 1) {
    throw new Error("policyVersion must be a positive integer");
  }
  if (input.creatorScript.length === 0 || input.creatorScript.length > 255) {
    throw new Error("creatorScript must be 1..255 bytes");
  }
  return taggedHash(
    "CoveToken",
    Buffer.concat([
      Buffer.from(input.chainIdentity, "utf8"),
      Buffer.from([input.policyVersion]),
      Buffer.from(tick, "utf8"),
      input.tokenNonce,
      Buffer.from([input.creatorScript.length]),
      input.creatorScript,
    ]),
  );
}

/** Hex string form (64 chars). */
export function tokenIdHex(input: TokenIdentityInput): string {
  return computeTokenId(input).toString("hex");
}
