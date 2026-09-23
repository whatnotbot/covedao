import { describe, expect, it } from "vitest";
import vectors from "../../../../docs/COVE_V1_TEST_VECTORS.json";
import {
  COVE_DEPLOY_LEN,
  COVE_MINT_LEN,
  COVE_TRANSFER_LEN,
  decodeCoveEnvelope,
  encodeCoveDeploy,
  encodeCoveMint,
  encodeCoveTransfer,
  isCoveMagic,
} from "./envelope.js";

const atoms = (tokens: number): bigint => BigInt(tokens) * 100_000_000n;

describe("Cove V1 binary envelope", () => {
  it("encodes + decodes DEPLOY (10 bytes)", () => {
    const data = encodeCoveDeploy("FROG");
    expect(data.length).toBe(COVE_DEPLOY_LEN);
    expect(isCoveMagic(data)).toBe(true);
    expect(decodeCoveEnvelope(data)).toEqual({ ok: true, envelope: { op: "deploy", tick: "FROG" } });
    // magic "COVE"
    expect(Buffer.from(data.subarray(0, 4)).toString("ascii")).toBe("COVE");
    expect(data[4]).toBe(1); // version
    expect(data[5]).toBe(0x01); // DEPLOY
  });

  it("encodes + decodes MINT (26 bytes)", () => {
    const data = encodeCoveMint("FROG", atoms(2_000_000), 0n);
    expect(data.length).toBe(COVE_MINT_LEN);
    expect(decodeCoveEnvelope(data)).toEqual({
      ok: true,
      envelope: { op: "mint", tick: "FROG", amt: atoms(2_000_000), s: 0n },
    });
    expect(data[5]).toBe(0x02); // MINT
  });

  it("encodes + decodes TRANSFER (18 bytes)", () => {
    const data = encodeCoveTransfer("FROG", atoms(500_000));
    expect(data.length).toBe(COVE_TRANSFER_LEN);
    expect(decodeCoveEnvelope(data)).toEqual({
      ok: true,
      envelope: { op: "transfer", tick: "FROG", amt: atoms(500_000) },
    });
    expect(data[5]).toBe(0x03); // TRANSFER
  });

  it("round-trips uint64 atom amounts (big-endian)", () => {
    const big = (1n << 63n) - 1n;
    const data = encodeCoveTransfer("ZZZZ", big);
    expect(decodeCoveEnvelope(data).envelope).toEqual({ op: "transfer", tick: "ZZZZ", amt: big });
  });

  it("rejects non-Cove magic", () => {
    const data = new TextEncoder().encode('{"p":"cove"}');
    expect(isCoveMagic(data)).toBe(false);
    expect(decodeCoveEnvelope(data).ok).toBe(false);
  });

  it("rejects wrong version", () => {
    const data = encodeCoveDeploy("FROG");
    data[4] = 2;
    expect(decodeCoveEnvelope(data)).toEqual({ ok: false, reason: "UNSUPPORTED_VERSION" });
  });

  it("rejects wrong length / trailing bytes", () => {
    const deploy = encodeCoveDeploy("FROG");
    const tooLong = new Uint8Array([...deploy, 0x00]);
    expect(decodeCoveEnvelope(tooLong)).toEqual({ ok: false, reason: "BAD_LENGTH" });
    expect(decodeCoveEnvelope(deploy.subarray(0, 9))).toEqual({ ok: false, reason: "BAD_LENGTH" });
  });

  it("rejects unknown opcode", () => {
    const data = encodeCoveDeploy("FROG");
    data[5] = 0x7f;
    expect(decodeCoveEnvelope(data).reason).toBe("UNSUPPORTED_OPERATION");
  });

  it("rejects invalid ticker bytes", () => {
    const data = encodeCoveDeploy("FROG");
    data[6] = 0x61; // lowercase 'a'
    expect(decodeCoveEnvelope(data)).toEqual({ ok: false, reason: "INVALID_TICKER" });
  });

  it("matches the committed golden + malicious hex vectors", () => {
    for (const v of vectors.envelope_golden as { hex: string; decode: Record<string, unknown> }[]) {
      const data = Uint8Array.from(Buffer.from(v.hex, "hex"));
      const r = decodeCoveEnvelope(data);
      expect(r.ok).toBe(true);
      // JSON numbers are finite; the encoder returns bigint atom amounts.
      const expected = { ...v.decode };
      for (const k of ["amt", "s"] as const) {
        if (typeof expected[k] === "number") expected[k] = BigInt(expected[k] as number);
      }
      expect(r.envelope).toEqual(expected);
    }
    for (const v of vectors.envelope_malicious as { hex: string; reason: string }[]) {
      const data = Uint8Array.from(Buffer.from(v.hex, "hex"));
      expect(decodeCoveEnvelope(data).reason).toBe(v.reason);
    }
  });
});
