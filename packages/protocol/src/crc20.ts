/**
 * CRC-20 observed on-chain format (forensics, NOT a validation spec).
 *
 * Derived from a real, confirmed mainnet transaction (see crc20.test.ts):
 *   txid e0b7e317a6311432bd3f03e9f8536b4dfed0625ddf5b96f5b1c6bc25bdb8ee2f
 *   block 968,175
 *   OP_RETURN: {"p":"crc-20","op":"transfer","tick":"LEAF","amt":"100000000000"}
 *
 * IMPORTANT: this documents what is OBSERVABLE on-chain. It does NOT imply
 * that any operation is Bitcoin-consensus-enforced. CRC-20 is client-side
 * (indexer) validated; pricing/supply/ticker rules are NOT enforced by Bitcoin
 * script (see docs/PROTOCOL_VERIFICATION.md).
 */

export interface Crc20Payload {
  p: string;
  op: string;
  tick: string;
  amt?: string;
  [key: string]: unknown;
}

/**
 * Decode a CRC-20 JSON payload. The JSON is carried as a UTF-8 string inside a
 * single OP_RETURN push (output 0 in the observed transfer).
 */
export function decodeCrc20Json(json: string): Crc20Payload | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.p !== "string" || parsed.p !== "crc-20") return null;
    if (typeof parsed.op !== "string") return null;
    if (typeof parsed.tick !== "string") return null;
    return parsed as unknown as Crc20Payload;
  } catch {
    return null;
  }
}

/**
 * Extract and decode the CRC-20 JSON from an OP_RETURN scriptPubKey hex.
 * Returns null if the output is not an OP_RETURN or not a CRC-20 payload.
 */
export function decodeCrc20OpReturn(scriptPubKeyHex: string): Crc20Payload | null {
  const spk = Buffer.from(scriptPubKeyHex, "hex");
  if (spk.length < 2 || spk[0] !== 0x6a) return null; // OP_RETURN
  // OP_RETURN payload may be a direct push or an OP_PUSHDATA1/2/4.
  let offset = 1;
  let len = spk[offset];
  if (len === undefined) return null;
  offset += 1;
  if (len === 0x4c) {
    len = spk[offset];
    offset += 1;
  } else if (len === 0x4d) {
    len = spk.readUInt16LE(offset);
    offset += 2;
  } else if (len === 0x4e) {
    len = spk.readUInt32LE(offset);
    offset += 4;
  }
  if (len === undefined) return null;
  const payload = spk.subarray(offset, offset + len).toString("utf8");
  return decodeCrc20Json(payload.trim());
}

/**
 * Observed LEAF transfer layout (fixture). Amounts are integer atoms with
 * 8 decimals (1 LEAF = 100,000,000 atoms). This is an OBSERVATION, not a rule.
 */
export const OBSERVED_LEAF_TRANSFER = {
  txid: "e0b7e317a6311432bd3f03e9f8536b4dfed0625ddf5b96f5b1c6bc25bdb8ee2f",
  blockHeight: 968175,
  opReturnHex:
    "6a437b2270223a226372632d3230222c226f70223a227472616e73666572222c227469636b223a224c454146222c22616d74223a223130303030303030303030303030227d",
  payload: { p: "crc-20", op: "transfer", tick: "LEAF", amt: "10000000000000" },
  // vout[1] recipient dust (P2WPKH)
  recipientAddress: "bc1qyztrfnc86g5hpcmn4k8j0ztufxre7q5k3ajxzs",
  recipientSats: 294,
  // vout[2] treasury fee (single-key P2TR)
  treasuryAddress: "bc1pv85mk7dh9ea4ylsamzvcwsseglj7smph8rm8hz8ksxg4d5q43u8selta0j",
  treasurySats: 1347,
  treasuryScriptPubKey:
    "512061e9bb79b72e7b527e1dd89987421947e5e86c3738f67b88f6819156d0158f0f",
} as const;
