import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { createHash } from "node:crypto";
import type { CoveState } from "./types.js";
import { stateHash } from "./state.js";

/**
 * State-committed P2TR construction (PRECOP / Astrolabe-inspired, NOT copied).
 *
 * The Taproot output key commits to the Cove state so the state is publicly
 * verifiable from the address, and two distinct states yield two distinct
 * outputs. The mechanism:
 *
 *   stateCommitment(state) = tagged_hash("CoveState", stateHash(state))
 *       (BIP340-style tagged hash — a domain-separated commitment, so it can
 *        never collide with a real Taproot script-tree merkle root.)
 *
 *   outputKey(P, state) = P + H_TapTweak(P || stateCommitment(state)) · G
 *       (BIP341 tweak; the state commitment plays the "script-tree root" role.)
 *
 *   outputScript(state) = 0x51 0x20 || xonly(outputKey)   (P2TR)
 *   address(state)      = bech32m(xonly(outputKey))
 *
 * Contract tree: in Phase 1 the script path is EMPTY — the spend is key-path
 * only, signed by the Guardian AFTER it independently validates the transition
 * (off-chain policy). The state commitment is folded into the key tweak, not
 * into an on-chain script. A future phase may put a Simplicity commitment into
 * the script path; that does not change the output-key construction.
 *
 * Bitcoin enforces: the Taproot spend (valid Schnorr key-path signature over Q).
 * The Guardian enforces: the state-transition policy (Bitcoin consensus does NOT
 * evaluate it under current mainnet rules).
 */

const COVE_STATE_TAG = "CoveState";

/**
 * BIP340-style tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg). Used for
 * the domain-separated state commitment (a custom tag bitcoinjs-lib does not
 * ship), and for the BIP341 "TapTweak" tweak.
 */
function taggedHash(tag: string, msg: Buffer): Buffer {
  const tagHash = createHash("sha256").update(tag, "utf8").digest();
  return createHash("sha256").update(tagHash).update(tagHash).update(msg).digest();
}

/** Domain-separated state commitment used as the tweak's "merkle root". */
export function stateCommitment(state: CoveState): Buffer {
  return taggedHash(COVE_STATE_TAG, Buffer.from(stateHash(state), "hex"));
}

/**
 * BIP341 key-path tweak scalar for a state-committed output:
 *   t = H_TapTweak(P || stateCommitment(state))
 * Exposed so the Guardian can construct the TWEAKED key pair (private key
 * d + t mod n) whose x-only public key equals the output key Q. Key-path
 * signing signs with Q, not with the untweaked internal key P.
 */
export function stateTweak(internalKey: Buffer, state: CoveState): Buffer {
  if (internalKey.length !== 32) {
    throw new Error(`internalKey must be 32 bytes (x-only), got ${internalKey.length}`);
  }
  return taggedHash("TapTweak", Buffer.concat([internalKey, stateCommitment(state)]));
}

export interface StateCommitment {
  /** x-only output key Q (32 bytes). */
  outputKey: Buffer;
  /** P2TR scriptPubKey: 0x51 0x20 || Q. */
  scriptPubKeyHex: string;
  /** bech32m address (network-dependent). */
  address: string;
}

/**
 * Derive the state-committed P2TR output for a given 32-byte x-only internal
 * key P and a state. Deterministic; S0 != S1 ⇒ outputKey differs.
 */
export function deriveStateOutput(
  internalKey: Buffer,
  state: CoveState,
  network: bitcoin.networks.Network = bitcoin.networks.regtest,
): StateCommitment {
  if (internalKey.length !== 32) {
    throw new Error(`internalKey must be 32 bytes (x-only), got ${internalKey.length}`);
  }
  const tweak = stateTweak(internalKey, state);
  const tweaked = ecc.xOnlyPointAddTweak(internalKey, tweak);
  if (!tweaked) {
    throw new Error(
      "State tweak produced the point at infinity (invalid for this internal key + state).",
    );
  }
  const outputKey = Buffer.from(tweaked.xOnlyPubkey);
  const scriptPubKeyHex = Buffer.concat([Buffer.from([0x51, 0x20]), outputKey]).toString("hex");
  const address = bitcoin.address.toBech32(outputKey, 1, network.bech32);
  return { outputKey, scriptPubKeyHex, address };
}

/** The P2TR output script as a Buffer (0x51 0x20 || Q). */
export function stateOutputScript(
  state: CoveState,
  internalKey: Buffer,
  network?: bitcoin.networks.Network,
): Buffer {
  return Buffer.from(deriveStateOutput(internalKey, state, network).scriptPubKeyHex, "hex");
}
