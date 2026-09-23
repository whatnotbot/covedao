import { describe, expect, it } from "vitest";
import {
  OP_DEPLOY,
  OP_MINT,
  OP_REDEEM,
  OP_TRANSFER,
  DATACARRIER_PAYLOAD_LIMIT,
} from "./opcodes.js";
import { decode, encodeAmount, encodeDeploy, WireError } from "./codec.js";

describe("compact binary wire codec — golden vectors", () => {
  it("DEPLOY FROG = 4356 01 01 04 46524f47 (9 bytes)", () => {
    expect(encodeDeploy({ tick: "FROG" }).toString("hex")).toBe("435601010446524f47");
    expect(encodeDeploy({ tick: "FROG" }).length).toBe(9);
  });

  it("MINT 42,000,000 = 4356 01 03 000000000280de80 (12 bytes)", () => {
    expect(encodeAmount({ op: OP_MINT, amount: 42_000_000n }).toString("hex")).toBe(
      "43560103000000000280de80",
    );
  });

  it("REDEEM 10,000,000 = 4356 01 04 0000000000989680", () => {
    expect(encodeAmount({ op: OP_REDEEM, amount: 10_000_000n }).toString("hex")).toBe(
      "435601040000000000989680",
    );
  });

  it("every payload is within the 80-byte datacarrier limit", () => {
    expect(encodeDeploy({ tick: "FROG" }).length).toBeLessThanOrEqual(DATACARRIER_PAYLOAD_LIMIT);
    expect(encodeAmount({ op: OP_MINT, amount: 840_000_000n }).length).toBeLessThanOrEqual(
      DATACARRIER_PAYLOAD_LIMIT,
    );
    expect(encodeAmount({ op: OP_REDEEM, amount: 1n }).length).toBeLessThanOrEqual(
      DATACARRIER_PAYLOAD_LIMIT,
    );
  });
});

describe("roundtrip", () => {
  it("deploy → decode → deploy", () => {
    const enc = encodeDeploy({ tick: "LEAF" });
    expect(decode(enc)).toEqual({ version: 1, op: OP_DEPLOY, tick: "LEAF" });
  });
  it("amount ops → decode → amount", () => {
    const ops = [OP_MINT, OP_REDEEM, OP_TRANSFER] as const;
    for (const op of ops) {
      expect(decode(encodeAmount({ op, amount: 123_456_789n }))).toEqual({
        version: 1,
        op,
        amount: 123_456_789n,
      });
    }
  });
});

describe("malformed inputs", () => {
  function expectWireError(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error(`expected WireError ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(WireError);
      expect((e as WireError).code).toBe(code);
    }
  }

  it("truncated payload rejected", () => {
    expectWireError(() => decode(Buffer.from([0x43])), "TRUNCATED");
    expectWireError(() => decode(Buffer.from([0x43, 0x56, 0x01])), "TRUNCATED");
  });
  it("bad magic rejected", () => {
    expectWireError(() => decode(Buffer.from([0x00, 0x00, 0x01, 0x01, 0x04])), "BAD_MAGIC");
  });
  it("bad version rejected", () => {
    expectWireError(() => decode(Buffer.from([0x43, 0x56, 0x02, 0x01, 0x04])), "BAD_VERSION");
  });
  it("bad opcode rejected", () => {
    expectWireError(() => decode(Buffer.from([0x43, 0x56, 0x01, 0xff, 0x00])), "BAD_OPCODE");
  });
  it("noncanonical deploy ticker length rejected", () => {
    expectWireError(() => decode(Buffer.from("435601010446524f", "hex")), "TRUNCATED");
  });
  it("amount payload of wrong size rejected", () => {
    expectWireError(() => decode(Buffer.from("4356010301", "hex")), "TRUNCATED");
  });
  it("oversized payload (amount op with extra bytes) rejected", () => {
    expectWireError(() => decode(Buffer.from("4356010300000000000000000000", "hex")), "TRUNCATED");
  });
  it("invalid ticker rejected", () => {
    expectWireError(() => encodeDeploy({ tick: "" }), "INVALID_TICKER");
    expectWireError(() => encodeDeploy({ tick: "x".repeat(17) }), "INVALID_TICKER");
    expectWireError(() => encodeDeploy({ tick: "FROG!" }), "INVALID_TICKER");
  });
  it("zero / negative amount rejected", () => {
    expectWireError(() => encodeAmount({ op: OP_MINT, amount: 0n }), "INVALID_AMOUNT");
    expectWireError(() => encodeAmount({ op: OP_REDEEM, amount: -1n }), "INVALID_AMOUNT");
  });
});
