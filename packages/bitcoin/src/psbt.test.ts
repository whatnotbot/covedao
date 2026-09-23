import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import { buildUnsignedPsbt } from "./psbt.js";

const TXID = "aa".repeat(32);
const p2wpkhSpk = "0014" + "ab".repeat(20);
const utxo = (spk: string, v: bigint, txid = TXID, vout = 0) => ({
  txid,
  vout,
  scriptPubKeyHex: spk,
  valueSats: v,
  confirmations: 6,
});

describe("buildUnsignedPsbt (relay-safety hardening)", () => {
  it("supports P2TR change/output addresses (ECC initialized)", () => {
    const r = buildUnsignedPsbt({
      network: "signet",
      inputs: [utxo(p2wpkhSpk, 1_000_000n)],
      outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 100_000n }],
      changeAddress: "tb1pvhu96rrd0f3kz8a5l7hdntrfj9vmmfk0tszf4arx2kujs6zz82dqxflggf",
      feeRateSatVb: 1n,
    });
    expect(r.psbtBase64.length).toBeGreaterThan(0);
  });

  it("rejects mainnet change address on a signet build", () => {
    expect(() =>
      buildUnsignedPsbt({
        network: "signet",
        inputs: [utxo(p2wpkhSpk, 1_000_000n)],
        outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 100_000n }],
        changeAddress: "bc1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws3s67hg",
        feeRateSatVb: 1n,
      }),
    ).toThrow();
  });

  it("rejects duplicate inputs", () => {
    expect(() =>
      buildUnsignedPsbt({
        network: "signet",
        inputs: [utxo(p2wpkhSpk, 100_000n), utxo(p2wpkhSpk, 100_000n)],
        outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 100_000n }],
        changeAddress: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa",
        feeRateSatVb: 1n,
      }),
    ).toThrow(/Duplicate input/);
  });

  it("rejects zero inputs", () => {
    expect(() =>
      buildUnsignedPsbt({
        network: "signet",
        inputs: [],
        outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 0n }],
        changeAddress: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa",
        feeRateSatVb: 0n,
      }),
    ).toThrow(/No inputs/);
  });

  it("rejects out-of-range (exceeds 21M BTC) output value", () => {
    expect(() =>
      buildUnsignedPsbt({
        network: "signet",
        inputs: [utxo(p2wpkhSpk, 21_000_000n * 100_000_000n)],
        outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 2_200_000_000_000_000n }],
        changeAddress: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa",
        feeRateSatVb: 1n,
      }),
    ).toThrow(/out of range/);
  });

  it("folds dust change into fee (no dust change output)", () => {
    // Engineer change to land below the P2WPKH dust threshold (294).
    const fee = 142n; // vsize ~142 @1 sat/vB for 1 in + 1 out + change
    const inVal = 100_000n;
    const outVal = inVal - fee - 200n; // leaves 200 sats change (< 294 dust)
    const r = buildUnsignedPsbt({
      network: "signet",
      inputs: [utxo(p2wpkhSpk, inVal)],
      outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: outVal }],
      changeAddress: "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa",
      feeRateSatVb: 1n,
    });
    const tx = bitcoin.Transaction.fromHex(r.unsignedHex);
    expect(r.changeSats).toBe(0n);
    expect(tx.outs.length).toBe(1); // no change output
  });
});
