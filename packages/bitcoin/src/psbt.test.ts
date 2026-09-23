import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import { buildUnsignedPsbt, type BuildTxParams } from "./psbt.js";

const TXID = "aa".repeat(32);
const p2wpkhSpk = "0014" + "ab".repeat(20);
const p2trSpk = "5120" + "cd".repeat(32);
const CHANGE = "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa";
const utxo = (spk: string, v: bigint, txid = TXID, vout = 0) => ({
  txid,
  vout,
  scriptPubKeyHex: spk,
  valueSats: v,
  confirmations: 6,
});

function build(overrides: Partial<BuildTxParams> = {}): ReturnType<typeof buildUnsignedPsbt> {
  return buildUnsignedPsbt({
    network: "signet",
    inputs: [utxo(p2wpkhSpk, 1_000_000n)],
    outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 100_000n }],
    changeAddress: CHANGE,
    feeRateSatVb: 2n,
    maxFeeRateSatVb: 100n,
    maxMinerFeeSats: 100_000n,
    ...overrides,
  });
}

describe("buildUnsignedPsbt (relay-safety hardening)", () => {
  it("supports P2TR change/output addresses (ECC initialized)", () => {
    const r = build({ changeAddress: "tb1pvhu96rrd0f3kz8a5l7hdntrfj9vmmfk0tszf4arx2kujs6zz82dqxflggf" });
    expect(r.psbtBase64.length).toBeGreaterThan(0);
  });

  it("reports the ACTUAL fee = totalIn − Σ(outputs)", () => {
    const r = build();
    const tx = bitcoin.Transaction.fromHex(r.unsignedHex);
    const outTotal = tx.outs.reduce((a, o) => a + BigInt(o.value), 0n);
    expect(r.feeSats).toBe(1_000_000n - outTotal);
  });

  it("rejects mainnet change address on a signet build", () => {
    expect(() => build({ changeAddress: "bc1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws3s67hg" })).toThrow();
  });

  it("rejects duplicate inputs", () => {
    expect(() =>
      build({ inputs: [utxo(p2wpkhSpk, 100_000n), utxo(p2wpkhSpk, 100_000n)] }),
    ).toThrow(/Duplicate input/);
  });

  it("rejects zero inputs", () => {
    expect(() => build({ inputs: [] })).toThrow(/No inputs/);
  });

  it("rejects out-of-range (exceeds 21M BTC) output value", () => {
    expect(() =>
      build({
        inputs: [utxo(p2wpkhSpk, 21_000_000n * 100_000_000n)],
        outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 2_200_000_000_000_000n }],
      }),
    ).toThrow(/out of range/);
  });

  it("folds dust change into fee and reports changeSats=0", () => {
    const r = build({
      inputs: [utxo(p2wpkhSpk, 100_000n)],
      outputs: [{ script: Buffer.from(p2wpkhSpk, "hex"), valueSats: 100_000n - 142n - 200n }],
      feeRateSatVb: 1n,
    });
    const tx = bitcoin.Transaction.fromHex(r.unsignedHex);
    expect(r.changeSats).toBe(0n);
    expect(tx.outs.length).toBe(1);
    expect(r.feeSats).toBe(100_000n - tx.outs.reduce((a, o) => a + BigInt(o.value), 0n));
  });

  it("signals RBF on every input (sequence 0xfffffffd)", () => {
    const r = build();
    const tx = bitcoin.Transaction.fromHex(r.unsignedHex);
    for (const input of tx.ins) {
      expect(input.sequence).toBe(0xfffffffd);
    }
  });

  it("sets SIGHASH_ALL on every input", () => {
    const r = build();
    const psbt = bitcoin.Psbt.fromBase64(r.psbtBase64, { network: bitcoin.networks.testnet });
    for (const input of psbt.data.inputs) {
      expect(input.sighashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
    }
  });

  it("rejects fee rate above the max cap", () => {
    expect(() => build({ feeRateSatVb: 101n, maxFeeRateSatVb: 100n })).toThrow(/exceeds max/);
  });

  it("rejects zero fee rate", () => {
    expect(() => build({ feeRateSatVb: 0n })).toThrow(/Fee rate/);
  });

  it("rejects miner fee above the max cap", () => {
    expect(() => build({ maxMinerFeeSats: 1n, inputs: [utxo(p2wpkhSpk, 1_000_000n)] })).toThrow(/exceeds max/);
  });

  it("rejects an output with neither address nor script", () => {
    expect(() =>
      buildUnsignedPsbt({
        network: "signet",
        inputs: [utxo(p2wpkhSpk, 1_000_000n)],
        outputs: [{ valueSats: 50_000n } as never],
        changeAddress: CHANGE,
        feeRateSatVb: 2n,
        maxFeeRateSatVb: 100n,
        maxMinerFeeSats: 100_000n,
      }),
    ).toThrow(/neither address nor script/);
  });

  it("rejects two OP_RETURN outputs", () => {
    expect(() =>
      build({
        outputs: [
          { script: Buffer.from("6a01ff", "hex"), valueSats: 0n },
          { script: Buffer.from("6a01ff", "hex"), valueSats: 0n },
        ],
      }),
    ).toThrow(/More than one OP_RETURN/);
  });

  it("rejects an oversized OP_RETURN payload", () => {
    const big = bitcoin.script.compile([0x6a, Buffer.alloc(100, 0x41)]);
    expect(() => build({ outputs: [{ script: big, valueSats: 0n }] })).toThrow(/exceeds/);
  });

  it("rejects a legacy P2PKH input as unsignable", () => {
    const p2pkh = "76a914" + "11".repeat(20) + "88ac";
    expect(() => build({ inputs: [utxo(p2pkh, 100_000n)] })).toThrow(/unsupported script type/);
  });

  it("builds a P2TR input with tapInternalKey", () => {
    const r = build({ inputs: [utxo(p2trSpk, 1_000_000n)] });
    const psbt = bitcoin.Psbt.fromBase64(r.psbtBase64, { network: bitcoin.networks.testnet });
    expect(psbt.data.inputs[0]!.tapInternalKey).toBeDefined();
  });
});
