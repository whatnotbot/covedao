import { describe, expect, it } from "vitest";
import {
  MAX_TRANSFER_ALLOCATIONS,
  decodeV2,
  encodeDeployV2,
  encodeMintV2,
  encodeRedeemV2,
  encodeTransferV2,
  reencodeV2,
  withinDatacarrier,
  WireV2Error,
  type TokenAllocation,
} from "./codecV2.js";

const NONCE = Buffer.alloc(32, 0xab);
const TOKENID = Buffer.alloc(32, 0xcd);
const ATOMS = 100_000_000n;

describe("wire v2 golden vectors", () => {
  it("DEPLOY V2 (FROG, nonce 0xab) = 42 bytes", () => {
    const hex = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE }).toString(
      "hex",
    );
    expect(hex).toBe("43560201030446524f47" + "ab".repeat(32));
    expect(hex.length / 2).toBe(42);
  });

  it("MINT V2 (42M tokens = 4.2e15 atoms, vout 1)", () => {
    const hex = encodeMintV2({
      tokenId: TOKENID,
      amount: 42_000_000n * ATOMS,
      recipientVout: 1,
    }).toString("hex");
    expect(hex).toBe("43560203" + "cd".repeat(32) + "000eebe0b40e8000" + "01");
  });

  it("TRANSFER V2 (two allocations 4/6 tokens)", () => {
    const hex = encodeTransferV2({
      tokenId: TOKENID,
      allocations: [
        { vout: 1, amount: 4n * ATOMS },
        { vout: 2, amount: 6n * ATOMS },
      ],
    }).toString("hex");
    expect(hex).toBe(
      "43560202" + "cd".repeat(32) + "02" + "01" + "0000000017d78400" + "02" + "0000000023c34600",
    );
  });

  it("REDEEM V2 (5 tokens + 5-token change, vout 1)", () => {
    const hex = encodeRedeemV2({
      tokenId: TOKENID,
      redeemAmount: 5n * ATOMS,
      changeAllocations: [{ vout: 1, amount: 5n * ATOMS }],
    }).toString("hex");
    expect(hex).toBe(
      "43560204" + "cd".repeat(32) + "000000001dcd6500" + "01" + "01" + "000000001dcd6500",
    );
  });

  it("all v2 payloads within datacarrier limit", () => {
    expect(
      withinDatacarrier(encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE })),
    ).toBe(true);
    expect(
      withinDatacarrier(encodeMintV2({ tokenId: TOKENID, amount: 1n, recipientVout: 0 })),
    ).toBe(true);
    expect(
      withinDatacarrier(
        encodeTransferV2({ tokenId: TOKENID, allocations: [{ vout: 0, amount: 1n }] }),
      ),
    ).toBe(true);
    expect(
      withinDatacarrier(
        encodeRedeemV2({ tokenId: TOKENID, redeemAmount: 1n, changeAllocations: [] }),
      ),
    ).toBe(true);
  });
});

describe("wire v2 roundtrip + canonicality", () => {
  it("decode(encode(x)) == x", () => {
    expect(
      decodeV2(encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE })),
    ).toEqual({ version: 2, op: 1, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });

    const mint = encodeMintV2({ tokenId: TOKENID, amount: 42n * ATOMS, recipientVout: 3 });
    expect(decodeV2(mint)).toEqual({
      version: 2,
      op: 3,
      tokenId: TOKENID,
      amount: 42n * ATOMS,
      recipientVout: 3,
    });

    const tAlloc: TokenAllocation[] = [
      { vout: 1, amount: 4n * ATOMS },
      { vout: 2, amount: 6n * ATOMS },
    ];
    expect(decodeV2(encodeTransferV2({ tokenId: TOKENID, allocations: tAlloc }))).toEqual({
      version: 2,
      op: 2,
      tokenId: TOKENID,
      allocations: tAlloc,
    });

    const rAlloc: TokenAllocation[] = [{ vout: 1, amount: 5n * ATOMS }];
    expect(
      decodeV2(
        encodeRedeemV2({ tokenId: TOKENID, redeemAmount: 5n * ATOMS, changeAllocations: rAlloc }),
      ),
    ).toEqual({
      version: 2,
      op: 4,
      tokenId: TOKENID,
      redeemAmount: 5n * ATOMS,
      changeAllocations: rAlloc,
    });
  });

  it("encode(decode(bytes)) == bytes (canonical)", () => {
    const deploy = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    expect(
      encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE }).equals(deploy),
    ).toBe(true);
    // re-encode from decode must reproduce identical bytes
    const d = decodeV2(deploy) as { policyVersion: number; ticker: string; tokenNonce: Buffer };
    expect(
      encodeDeployV2({
        policyVersion: d.policyVersion,
        ticker: d.ticker,
        tokenNonce: d.tokenNonce,
      }).equals(deploy),
    ).toBe(true);
  });
});

describe("wire v2 rejection (canonicality)", () => {
  function expectWireError(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error(`expected ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(WireV2Error);
      expect((e as WireV2Error).code).toBe(code);
    }
  }

  it("zero / overflow amount", () => {
    expectWireError(
      () => encodeMintV2({ tokenId: TOKENID, amount: 0n, recipientVout: 0 }),
      "ZERO_AMOUNT",
    );
    expectWireError(
      () => encodeMintV2({ tokenId: TOKENID, amount: 1n << 64n, recipientVout: 0 }),
      "AMOUNT_OVERFLOW",
    );
  });
  it("invalid tokenId", () => {
    expectWireError(
      () => encodeMintV2({ tokenId: Buffer.alloc(31), amount: 1n, recipientVout: 0 }),
      "INVALID_TOKEN_ID",
    );
    expectWireError(
      () => encodeMintV2({ tokenId: Buffer.alloc(32), amount: 1n, recipientVout: 0 }),
      "INVALID_TOKEN_ID",
    );
  });
  it("invalid vout", () => {
    expectWireError(
      () => encodeMintV2({ tokenId: TOKENID, amount: 1n, recipientVout: 256 }),
      "INVALID_VOUT",
    );
  });
  it("duplicate allocation vout", () => {
    expectWireError(
      () =>
        encodeTransferV2({
          tokenId: TOKENID,
          allocations: [
            { vout: 1, amount: 1n },
            { vout: 1, amount: 2n },
          ],
        }),
      "DUPLICATE_VOUT",
    );
  });
  it("zero / too many allocations", () => {
    expectWireError(
      () => encodeTransferV2({ tokenId: TOKENID, allocations: [] }),
      "ZERO_ALLOCATIONS",
    );
    const many = Array.from({ length: MAX_TRANSFER_ALLOCATIONS + 1 }, (_, i) => ({
      vout: i,
      amount: 1n,
    }));
    expectWireError(
      () => encodeTransferV2({ tokenId: TOKENID, allocations: many }),
      "TOO_MANY_ALLOCATIONS",
    );
  });
  it("bad policy version on deploy", () => {
    expectWireError(
      () => encodeDeployV2({ policyVersion: 2, ticker: "FROG", tokenNonce: NONCE }),
      "BAD_POLICY_VERSION",
    );
  });
  it("trailing bytes / truncated rejected on decode", () => {
    const mint = encodeMintV2({ tokenId: TOKENID, amount: 1n, recipientVout: 0 });
    expectWireError(() => decodeV2(Buffer.concat([mint, Buffer.from([0x00])])), "TRUNCATED");
    expectWireError(() => decodeV2(mint.subarray(0, 10)), "TRUNCATED");
    expectWireError(() => decodeV2(Buffer.from([0x43, 0x56, 0x01, 0x01])), "BAD_VERSION");
    expectWireError(() => decodeV2(Buffer.from([0x00, 0x00, 0x02, 0x01])), "BAD_MAGIC");
  });
});

describe("wire v2 fuzz: decoder never crashes", () => {
  it("random bytes never throw non-WireV2Error", () => {
    let seed = 0xdeadbeef;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 2000; i++) {
      const len = rand() % 120;
      const buf = Buffer.alloc(len);
      for (let j = 0; j < len; j++) buf[j] = rand() & 0xff;
      try {
        decodeV2(buf);
      } catch (e) {
        expect(e).toBeInstanceOf(WireV2Error);
      }
    }
  });
});

describe("wire v2 decoder canonicality — raw noncanonical bytes (§1)", () => {
  const hdr = (op: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt16BE(0x4356, 0);
    b[2] = 2;
    b[3] = op;
    return b;
  };
  const u64 = (n: bigint): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(n, 0);
    return b;
  };
  function expectWireError(fn: () => unknown, code: string): void {
    try {
      fn();
      throw new Error(`expected ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(WireV2Error);
      expect((e as WireV2Error).code).toBe(code);
    }
  }

  it("raw zero-amount MINT rejected", () => {
    expectWireError(
      () => decodeV2(Buffer.concat([hdr(3), Buffer.alloc(32, 0xcd), u64(0n), Buffer.from([1])])),
      "ZERO_AMOUNT",
    );
  });

  it("raw zero-tokenId MINT/TRANSFER/REDEEM rejected", () => {
    expectWireError(
      () => decodeV2(Buffer.concat([hdr(3), Buffer.alloc(32), u64(1n), Buffer.from([1])])),
      "INVALID_TOKEN_ID",
    );
    expectWireError(
      () => decodeV2(Buffer.concat([hdr(2), Buffer.alloc(32), Buffer.from([1, 1]), u64(1n)])),
      "INVALID_TOKEN_ID",
    );
    expectWireError(
      () => decodeV2(Buffer.concat([hdr(4), Buffer.alloc(32), u64(1n), Buffer.from([0])])),
      "INVALID_TOKEN_ID",
    );
  });

  it("raw zero-allocation TRANSFER rejected", () => {
    expectWireError(
      () => decodeV2(Buffer.concat([hdr(2), Buffer.alloc(32, 0xcd), Buffer.from([0])])),
      "ZERO_ALLOCATIONS",
    );
  });

  it("raw lowercase DEPLOY rejected", () => {
    // ticker "frog" (lowercase) must be rejected (noncanonical).
    const tick = Buffer.from("frog");
    expectWireError(
      () =>
        decodeV2(Buffer.concat([hdr(1), Buffer.from([3, tick.length]), tick, Buffer.alloc(32)])),
      "NONCANONICAL_TICKER",
    );
  });

  it("raw policyVersion=2 DEPLOY rejected", () => {
    const tick = Buffer.from("FROG");
    expectWireError(
      () =>
        decodeV2(Buffer.concat([hdr(1), Buffer.from([2, tick.length]), tick, Buffer.alloc(32)])),
      "BAD_POLICY_VERSION",
    );
  });

  it("raw allocation sum overflow rejected", () => {
    // two allocations each = u64::MAX - 1 → sum overflows.
    const max = 0xffffffffffffffffn;
    const payload = Buffer.concat([
      hdr(2),
      Buffer.alloc(32, 0xcd),
      Buffer.from([2]),
      Buffer.from([1]),
      u64(max - 1n),
      Buffer.from([2]),
      u64(max - 1n),
    ]);
    expectWireError(() => decodeV2(payload), "AMOUNT_OVERFLOW");
  });

  it("raw trailing bytes rejected", () => {
    const mint = Buffer.concat([hdr(3), Buffer.alloc(32, 0xcd), u64(1n), Buffer.from([1])]);
    expectWireError(() => decodeV2(Buffer.concat([mint, Buffer.from([0xff])])), "TRUNCATED");
  });

  it("canonical re-encode roundtrip: reencodeV2(decodeV2(x)) == x", () => {
    const deploy = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    const mint = encodeMintV2({ tokenId: TOKENID, amount: 42n * ATOMS, recipientVout: 3 });
    const transfer = encodeTransferV2({
      tokenId: TOKENID,
      allocations: [
        { vout: 1, amount: 4n * ATOMS },
        { vout: 2, amount: 6n * ATOMS },
      ],
    });
    const redeem = encodeRedeemV2({
      tokenId: TOKENID,
      redeemAmount: 5n * ATOMS,
      changeAllocations: [{ vout: 1, amount: 5n * ATOMS }],
    });
    for (const x of [deploy, mint, transfer, redeem]) {
      expect(reencodeV2(decodeV2(x)).equals(x)).toBe(true);
    }
  });
});
