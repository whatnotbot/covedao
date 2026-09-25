import { taggedHash } from "./taproot.js";

/**
 * The Cove execution-leaf policy identity. Binds the exact policy that is
 * pre-executed into the Taproot construction:
 *
 *   policyIdentityHash = H_CovePolicy(
 *       policyVersion || operation || tokenId || currentStateHash || simplicityCmr)
 *
 * The leaf commits which policy/operation/token/state/vault is authorized — it
 * does NOT precommit one arbitrary future successor (that is bound at spend time
 * by Guardian validation + SIGHASH semantics + the actual outputs).
 */

export const COVE_PROTOCOL_VERSION = 1;
export const OP_MINT = 0x03;
export const OP_REDEEM = 0x04;

/**
 * Cove covenant policy-set versions.
 *
 *   COVE_POLICY_V1 = MINT only (historical, Phase 3)
 *   COVE_POLICY_V2 = MINT + REDEEM (historical, Phase 4)
 *   COVE_POLICY_V3 = MINT + REDEEM with enforced u64 overflow/borrow (production)
 *
 * Each operation's execution leaf commits
 * `policyIdentityHash(version, op, tokenId, currentStateHash, cmr)`.
 */
export const COVE_POLICY_V1 = 1;
export const COVE_POLICY_V2 = 2;
export const COVE_POLICY_V3 = 3;

export interface PolicyCmrs {
  mint: string;
  redeem?: string;
}

/** Frozen Simplicity CMRs per policy version (see @crclaunch/cove-simplicity). */
export const COVE_POLICY_CMRS: Record<number, PolicyCmrs> = {
  [COVE_POLICY_V1]: {
    mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
  },
  [COVE_POLICY_V2]: {
    mint: "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2",
    redeem: "a15ac4cbc450ac2dd113b1a9de178450ccc893a5213d8a2f56471fcd9aa274b7",
  },
  [COVE_POLICY_V3]: {
    mint: "ccdb02000fdb372bfa2e166b9fe0192715d555fc5720f8008ee741fe1a0d58ec",
    redeem: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
  },
};

export interface PolicyIdentity {
  /** Covenant policy-set version (COVE_POLICY_Vn). */
  version: number;
  /** Operation authorized by this leaf (OP_MINT | OP_REDEEM). */
  operation: number;
  /** 32-byte token identity (64-hex). */
  tokenId: string;
  /** Committed CURRENT state hash (32 bytes) — NOT a future successor. */
  currentStateHash: Buffer;
  /** Real Simplicity CMR of the pre-executed policy (32 bytes). */
  cmr: Buffer;
}

export function policyIdentityHash(p: PolicyIdentity): Buffer {
  if (!/^[0-9a-f]{64}$/.test(p.tokenId)) {
    throw new Error("tokenId must be 64 hex chars");
  }
  if (p.currentStateHash.length !== 32) {
    throw new Error("currentStateHash must be 32 bytes");
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
      p.currentStateHash,
      p.cmr,
    ]),
  );
}
