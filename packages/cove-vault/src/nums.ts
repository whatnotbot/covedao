/**
 * The Cove covenant NUMS (Nothing-Up-My-Sleeve) internal key.
 *
 * This is the standard BIP341 NUMS point recommended for "unspendable" internal
 * keys: the x-coordinate produced by hashing the secp256k1 generator and lifting
 * the result to a curve point:
 *
 *   H = lift_x(SHA256("secp256k1 generator point"))  (BIP341 § "constructing
 *   and spending Taproot outputs"; the same H used in the BIP341 test vectors.)
 *
 * Its discrete logarithm is assumed unknown, so there is NO key-path spending
 * key for a Cove vault. Every spend MUST use the script path (execution or
 * recovery leaf). This is a hard property of the Cove vault, unlike the
 * reference PRECOP implementation which uses an HD key and signs key-path.
 */
export const COVE_NUMS_X_ONLY = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

/** The NUMS internal key as a 32-byte x-only Buffer. */
export function numsInternalKey(): Buffer {
  return Buffer.from(COVE_NUMS_X_ONLY, "hex");
}
