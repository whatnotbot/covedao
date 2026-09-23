import { createHash } from "node:crypto";
import * as ecc from "tiny-secp256k1";

/**
 * Minimal, self-contained BIP340/BIP341 primitives for the Cove vault. These are
 * the exact same constructions bitcoinjs-lib uses internally, implemented here so
 * the golden vectors are auditable without depending on a private module.
 */

export const LEAF_VERSION_TAPSCRIPT = 0xc0;

/** BIP340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg). */
export function taggedHash(tag: string, msg: Buffer): Buffer {
  const tagHash = createHash("sha256").update(tag, "utf8").digest();
  return createHash("sha256").update(tagHash).update(tagHash).update(msg).digest();
}

/** BIP341 tapleaf hash: TapLeaf-tagged hash of (leaf_version || compact_size(script) || script). */
export function tapleafHash(script: Buffer, version = LEAF_VERSION_TAPSCRIPT): Buffer {
  const varint = Buffer.from([version]);
  let lenBuf: Buffer;
  if (script.length < 0xfd) {
    lenBuf = Buffer.from([script.length]);
  } else if (script.length <= 0xffff) {
    lenBuf = Buffer.from([0xfd, script.length & 0xff, (script.length >> 8) & 0xff]);
  } else {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(script.length, 1);
    lenBuf = b;
  }
  return taggedHash("TapLeaf", Buffer.concat([varint, lenBuf, script]));
}

/** BIP341 TapBranch hash (children MUST be sorted lexicographically first). */
export function tapBranchHash(a: Buffer, b: Buffer): Buffer {
  const left = Buffer.compare(a, b) <= 0 ? a : b;
  const right = Buffer.compare(a, b) <= 0 ? b : a;
  return taggedHash("TapBranch", Buffer.concat([left, right]));
}

/** BIP341 tweak scalar: TapTweak-tagged hash of (xonly_internal_key || merkle_root). */
export function tapTweak(internalKey: Buffer, merkleRoot: Buffer): Buffer {
  return taggedHash("TapTweak", Buffer.concat([internalKey, merkleRoot]));
}

/** BIP341 output key: Q = P + H_TapTweak(P || merkleRoot)·G. */
export function tweakKey(
  internalKey: Buffer,
  merkleRoot: Buffer,
): { outputKey: Buffer; parity: number } {
  const tweak = tapTweak(internalKey, merkleRoot);
  const res = ecc.xOnlyPointAddTweak(internalKey, tweak);
  if (!res) {
    throw new Error("Taproot tweak produced the point at infinity");
  }
  return { outputKey: Buffer.from(res.xOnlyPubkey), parity: res.parity };
}
