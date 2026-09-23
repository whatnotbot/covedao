import { describe, expect, it } from "vitest";
import { parseCoveEnvelope } from "./parser.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("parseCoveEnvelope", () => {
  it("parses a valid deploy envelope", () => {
    const r = parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"deploy","tick":"FROG"}'));
    expect(r.ok).toBe(true);
    expect(r.envelope).toEqual({ p: "cove", v: 1, protocol: "cove", op: "deploy", tick: "FROG" });
  });

  it("parses a valid mint envelope (whole tokens)", () => {
    const r = parseCoveEnvelope(
      enc('{"p":"cove","v":1,"op":"mint","tick":"FROG","amt":"1000000","s":"0"}'),
    );
    expect(r.ok).toBe(true);
    expect(r.envelope).toEqual({
      p: "cove",
      v: 1,
      protocol: "cove",
      op: "mint",
      tick: "FROG",
      amt: 1_000_000n,
      s: 0n,
    });
  });

  it("parses a valid transfer envelope", () => {
    const r = parseCoveEnvelope(
      enc('{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"500000"}'),
    );
    expect(r.ok).toBe(true);
    expect(r.envelope).toEqual({
      p: "cove",
      v: 1,
      protocol: "cove",
      op: "transfer",
      tick: "FROG",
      amt: 500_000n,
    });
  });

  it("accepts field reordering (semantics derive from fields, not order)", () => {
    const r = parseCoveEnvelope(enc('{"tick":"FROG","op":"deploy","v":1,"p":"cove"}'));
    expect(r.ok).toBe(true);
  });

  it("fits a maximum supply mint within 80 bytes", () => {
    // Whole-token amounts cap at 9 digits; the envelope stays within the
    // OP_RETURN datacarrier budget.
    const full = '{"p":"cove","v":1,"op":"mint","tick":"FROG","amt":"840000000","s":"840000000"}';
    expect(Buffer.byteLength(full, "utf8")).toBeLessThanOrEqual(80);
    expect(parseCoveEnvelope(enc(full)).ok).toBe(true);
  });

  it("rejects wrong protocol", () => {
    expect(parseCoveEnvelope(enc('{"p":"crc-20","v":1,"op":"deploy","tick":"FROG"}'))).toEqual({
      ok: false,
      reason: "WRONG_PROTOCOL",
    });
  });

  it("rejects unsupported version", () => {
    expect(parseCoveEnvelope(enc('{"p":"cove","v":2,"op":"deploy","tick":"FROG"}'))).toEqual({
      ok: false,
      reason: "UNSUPPORTED_VERSION",
    });
  });

  it("rejects unknown operation", () => {
    expect(parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"list","tick":"FROG"}'))).toEqual({
      ok: false,
      reason: "UNSUPPORTED_OPERATION",
    });
  });

  it("rejects duplicate keys", () => {
    expect(
      parseCoveEnvelope(enc('{"p":"cove","p":"cove","v":1,"op":"deploy","tick":"FROG"}')),
    ).toEqual({ ok: false, reason: "DUPLICATE_KEYS" });
  });

  it("rejects oversized payload", () => {
    const big = `{"p":"cove","v":1,"op":"deploy","tick":"${"X".repeat(100)}"}`;
    expect(parseCoveEnvelope(enc(big))).toEqual({ ok: false, reason: "OVERSIZED_PAYLOAD" });
  });

  it("rejects malformed UTF-8", () => {
    expect(parseCoveEnvelope(new Uint8Array([0xff, 0xfe, 0xfd]))).toEqual({
      ok: false,
      reason: "MALFORMED_UTF8",
    });
  });

  it("rejects malformed JSON", () => {
    expect(parseCoveEnvelope(enc("not json"))).toEqual({ ok: false, reason: "MALFORMED_JSON" });
  });

  it("rejects non-object JSON", () => {
    expect(parseCoveEnvelope(enc("[1,2,3]"))).toEqual({ ok: false, reason: "NOT_OBJECT" });
  });

  it("rejects invalid ticker forms", () => {
    expect(parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"deploy","tick":"frog"}'))).toEqual({
      ok: false,
      reason: "INVALID_TICKER",
    });
    expect(parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"deploy","tick":"FROGS"}'))).toEqual({
      ok: false,
      reason: "INVALID_TICKER",
    });
    expect(parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"deploy","tick":"FRO!"}'))).toEqual({
      ok: false,
      reason: "INVALID_TICKER",
    });
    // mint/transfer reference the deployment by ticker, so the ticker is validated there too.
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"mint","tick":"frog","amt":"1","s":"0"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_TICKER",
    });
  });

  it("rejects invalid amounts", () => {
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"0"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_AMOUNT",
    });
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"-1"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_AMOUNT",
    });
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"1.5"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_AMOUNT",
    });
    // Non-canonical leading zeros are rejected.
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"007"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_AMOUNT",
    });
  });

  it("rejects invalid mint supply", () => {
    expect(
      parseCoveEnvelope(enc('{"p":"cove","v":1,"op":"mint","tick":"FROG","amt":"1","s":"x"}')),
    ).toEqual({
      ok: false,
      reason: "INVALID_SUPPLY",
    });
  });
});
