import { describe, expect, it } from "vitest";
import { bitcoin, type BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { createCoveState } from "@crclaunch/protocol";
import { computeFee, feeRateExceedsCap, validatePure } from "./signet-proof.js";

function buildSignedHex(inputs: { valueSats: bigint }[], outputs: { valueSats: bigint }[]): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  for (const i of inputs) {
    tx.addInput(Buffer.from("a".repeat(64), "hex"), 0, 0xfffffffd);
    void i;
  }
  for (const o of outputs) {
    tx.addOutput(Buffer.from("0014" + "bb".repeat(20), "hex"), Number(o.valueSats));
  }
  return tx.toHex();
}

describe("computeFee (authoritative prevouts → actual fee)", () => {
  it("computes fee = Σ prevValueSats − Σ outputs (NOT zero-input)", () => {
    const signedHex = buildSignedHex([{ valueSats: 1_000_000n }], [{ valueSats: 999_000n }]);
    const tx: BitcoinProtocolTx = {
      txid: "x".repeat(64),
      version: 2,
      locktime: 0,
      inputs: [{ prevTxid: "a".repeat(64), vout: 0, sequence: 0, prevScriptPubKeyHex: "0014" + "aa".repeat(20), prevValueSats: 1_000_000n }],
      outputs: [{ index: 0, scriptPubKeyHex: "0014" + "bb".repeat(20), valueSats: 999_000n }],
    };
    const fee = computeFee(tx, signedHex);
    expect(fee.feeSats).toBe(1_000n);
    expect(fee.feeRate).toBeGreaterThan(0n);
  });

  it("rejects negative fee", () => {
    const tx: BitcoinProtocolTx = {
      txid: "x".repeat(64),
      version: 2,
      locktime: 0,
      inputs: [{ prevTxid: "a".repeat(64), vout: 0, sequence: 0, prevValueSats: 900n }],
      outputs: [{ index: 0, scriptPubKeyHex: "0014" + "bb".repeat(20), valueSats: 1_000n }],
    };
    expect(() => computeFee(tx, buildSignedHex([{ valueSats: 900n }], [{ valueSats: 1_000n }]))).toThrow(/negative fee/);
  });
});

describe("feeRateExceedsCap (multiplication, no floor)", () => {
  it("catches fractional fee-rate overflow that floor-division would miss", () => {
    // fee 101 sats over 50 vbytes = 2.02 sat/vB. Floor division gives 2 (<= cap 2),
    // but multiplication 101 > 2*50 = 100 correctly flags it.
    expect(feeRateExceedsCap(101n, 50, 2n)).toBe(true);
    expect(101n / 50n).toBe(2n); // the floor would have passed
  });

  it("accepts exactly-at-cap fee", () => {
    expect(feeRateExceedsCap(100n, 50, 2n)).toBe(false);
    expect(feeRateExceedsCap(99n, 50, 2n)).toBe(false);
  });
});

describe("validatePure (non-mutating preflight)", () => {
  it("does not mutate the state", () => {
    const state = createCoveState();
    const before = JSON.stringify([...state.tokens.entries()]);
    const tx: BitcoinProtocolTx = {
      txid: "d".repeat(64),
      version: 2,
      locktime: 0,
      inputs: [{ prevTxid: "a".repeat(64), vout: 0, sequence: 0, prevScriptPubKeyHex: "0014" + "aa".repeat(20), prevValueSats: 100_000n }],
      outputs: [
        { index: 0, scriptPubKeyHex: "6a0a", valueSats: 0n, opReturnData: new Uint8Array([0x43, 0x4f, 0x56, 0x45, 0x01, 0x01, 0x46, 0x52, 0x4f, 0x47]) },
        { index: 1, scriptPubKeyHex: "0014" + "cc".repeat(20), valueSats: 10_000n },
      ],
    };
    validatePure(state, tx, 0);
    const after = JSON.stringify([...state.tokens.entries()]);
    expect(after).toBe(before);
  });
});
