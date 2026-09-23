import { taggedHash } from "./taproot.js";

/**
 * The Cove execution-leaf policy identity. Binds the exact policy that is
 * pre-executed into the Taproot construction:
 *
 *   policyIdentityHash = H_CovePolicy(
 *       version || operation || tokenId || successorStateHash || simplicityCmr)
 *
 * where version=1, operation=MINT (0x03), tokenId is the 32-byte token identity,
 * successorStateHash is the committed successor state hash, and simplicityCmr is
 * the real Simplicity Commitment Merkle Root of the MINT policy (see
 * `@crclaunch/cove-simplicity`).
 */

export const COVE_PROTOCOL_VERSION = 1;
export const OP_MINT = 0x03;

export interface PolicyIdentity {
  version: number;
  operation: number;
  /** 32-byte token identity (64-hex). */
  tokenId: string;
  /** Committed successor state hash (32 bytes). */
  successorStateHash: Buffer;
  /** Real Simplicity CMR of the pre-executed MINT policy (32 bytes). */
  cmr: Buffer;
}

export function policyIdentityHash(p: PolicyIdentity): Buffer {
  if (!/^[0-9a-f]{64}$/.test(p.tokenId)) {
    throw new Error("tokenId must be 64 hex chars");
  }
  if (p.successorStateHash.length !== 32) {
    throw new Error("successorStateHash must be 32 bytes");
  }
  if (p.cmr.length !== 32) {
    throw new Error("cmr must be 32 bytes");
  }
  return taggedHash(
    "CovePolicy",
    Buffer.concat([
      Buffer.from([p.version]),
      Buffer.from([p.operation]),
      Buffer.from(p.tokenId, "hex"),
      p.successorStateHash,
      p.cmr,
    ]),
  );
}
