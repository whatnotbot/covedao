/**
 * Cove wire protocol constants + operation opcodes. Single canonical registry.
 *
 * The on-chain OP_RETURN uses a compact, versioned BINARY transport (see
 * codec.ts). `crc-20` is the LOGICAL protocol identity (see discovery.ts); the wire payload
 * carries an explicit binary version and a compact op + payload.
 *
 * Redundant values (curve id, supply caps, policy CMR) are NOT repeated on-chain
 * — they are fixed by the protocol/policy version. tokenId = DEPLOY txid once
 * the asset exists.
 */

export const COVE_PROTOCOL_ID = "crc-20";

/** Binary wire version. Bump on any breaking transport change. */
export const COVE_WIRE_VERSION = 1;

/** 2-byte binary magic discriminator ("CV" = Cove). */
export const COVE_WIRE_MAGIC = 0x4356;

export const OP_DEPLOY = 0x01;
export const OP_TRANSFER = 0x02;
export const OP_MINT = 0x03;
export const OP_REDEEM = 0x04;

/** Maximum ticker length (bytes) in the compact DEPLOY payload. */
export const MAX_TICKER_BYTES = 16;

/** Default Bitcoin Core datacarrier payload limit (80 bytes). */
export const DATACARRIER_PAYLOAD_LIMIT = 80;

/** Production covenant policy-set version (COVE_POLICY_V3). */
export const COVE_POLICY_V3 = 3;

export function opName(op: number): string {
  switch (op) {
    case OP_DEPLOY:
      return "deploy";
    case OP_TRANSFER:
      return "transfer";
    case OP_MINT:
      return "mint";
    case OP_REDEEM:
      return "redeem";
    default:
      return `unknown(0x${op.toString(16)})`;
  }
}
