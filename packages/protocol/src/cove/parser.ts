/**
 * Cove V1 OP_RETURN envelope parser. Strict canonical-JSON interpretation:
 * semantics derive only from parsed fields; field ordering is irrelevant.
 * Rejects duplicate keys, unknown version, wrong types, oversized fields,
 * malformed UTF-8/JSON, non-canonical integers, and unsupported operations.
 *
 * Wire-format constraints (see docs/COVE_PROTOCOL_V1.md):
 *  - deployments are referenced by their 4-char TICKER (unique, CRC-20 style),
 *    NOT by a 64-hex txid — a txid reference would exceed the 80-byte
 *    OP_RETURN datacarrier budget for mint/transfer.
 *  - amounts are WHOLE tokens (the canonical curve unit), not 8-decimal atoms,
 *    so a fully-qualified mint envelope never exceeds 80 bytes.
 */

export type CoveOp = "deploy" | "mint" | "transfer";

export interface CoveDeploy {
  op: "deploy";
  tick: string;
}

export interface CoveMint {
  op: "mint";
  tick: string;
  amt: bigint;
  s: bigint;
}

export interface CoveTransfer {
  op: "transfer";
  tick: string;
  amt: bigint;
}

export type CoveEnvelope = { p: "cove"; v: 1; protocol: "cove" } & (
  CoveDeploy | CoveMint | CoveTransfer
);

export interface CoveParseResult {
  ok: boolean;
  envelope?: CoveEnvelope;
  reason?: string;
}

export const COVE_PROTOCOL = "cove";
export const COVE_VERSION = 1;

const TICK_RE = /^[A-Z0-9]{4}$/;
const INT_RE = /^[0-9]+$/;
const MAX_PAYLOAD_BYTES = 80;

/** Reject duplicate JSON keys (flat payload; values never contain `":`). */
function hasDuplicateKeys(json: string): boolean {
  const keys: string[] = [];
  const re = /"([^"]+)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) keys.push(m[1]!);
  return new Set(keys).size !== keys.length;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse a canonical non-negative integer string (no leading zeros, no sign). */
function parseUintField(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  if (!INT_RE.test(v)) return null;
  if (v.length > 1 && v[0] === "0") return null; // non-canonical leading zero
  return BigInt(v);
}

function parseTicker(v: unknown): string | null {
  return typeof v === "string" && TICK_RE.test(v) ? v : null;
}

/** Parse a Cove OP_RETURN payload (Uint8Array) into a normalized envelope. */
export function parseCoveEnvelope(data: Uint8Array): CoveParseResult {
  if (data.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "OVERSIZED_PAYLOAD" };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return { ok: false, reason: "MALFORMED_UTF8" };
  }
  if (hasDuplicateKeys(text)) return { ok: false, reason: "DUPLICATE_KEYS" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "MALFORMED_JSON" };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: "NOT_OBJECT" };

  if (parsed.p !== COVE_PROTOCOL) return { ok: false, reason: "WRONG_PROTOCOL" };
  if (parsed.v !== COVE_VERSION) return { ok: false, reason: "UNSUPPORTED_VERSION" };

  const op = parsed.op;
  const tick = parseTicker(parsed.tick);

  if (op === "deploy") {
    if (tick === null) return { ok: false, reason: "INVALID_TICKER" };
    return { ok: true, envelope: { p: "cove", v: 1, protocol: "cove", op: "deploy", tick } };
  }

  if (op === "mint" || op === "transfer") {
    if (tick === null) return { ok: false, reason: "INVALID_TICKER" };
    const amt = parseUintField(parsed.amt);
    if (amt === null || amt === 0n) return { ok: false, reason: "INVALID_AMOUNT" };
    if (op === "mint") {
      const s = parseUintField(parsed.s);
      if (s === null) return { ok: false, reason: "INVALID_SUPPLY" };
      return {
        ok: true,
        envelope: { p: "cove", v: 1, protocol: "cove", op: "mint", tick, amt, s },
      };
    }
    return { ok: true, envelope: { p: "cove", v: 1, protocol: "cove", op: "transfer", tick, amt } };
  }

  return { ok: false, reason: "UNSUPPORTED_OPERATION" };
}
