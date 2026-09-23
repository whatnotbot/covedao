import { describe, expect, it } from "vitest";
import { buildUnsignedPsbt, decodeUnsignedOutputs, opReturnScriptData } from "@crclaunch/bitcoin";
import type { TransactionOutput, UnsignedProtocolTransaction } from "@crclaunch/protocol";
import { verifyWalletTransaction } from "./verify-wallet-tx";

const WALLET = "tb1qznd5zwx4dghvlvggsx5muw2dnuepnpdj7ud0ys"; // valid signet/testnet address
const CHANGE_ADDRESS = WALLET;

function out(index: number, kind: TransactionOutput["kind"], amountSats: bigint, address: string | null): TransactionOutput {
  return { index, kind, amountSats, address };
}

function fixture(overrides: Partial<UnsignedProtocolTransaction> = {}): UnsignedProtocolTransaction {
  return {
    operation: "DEPLOY",
    network: "mock",
    txHex: null,
    psbtBase64: null,
    inputs: [],
    outputs: [],
    feeSats: 0n,
    stateHash: "st",
    expiresAtHeight: 0n,
    expiresAtTimestamp: "2026-01-01T00:00:00Z",
    summary: { operation: "DEPLOY", outputCount: 0 },
    ...overrides,
  };
}

describe("verifyWalletTransaction (client-side pre-sign check)", () => {
  it("rejects a change output redirected to an attacker", () => {
    const tx = fixture({
      outputs: [out(0, "change", 1_000n, "bc1qattacker000000000000000000000000000000000000")],
    });
    expect(() => verifyWalletTransaction(tx, WALLET)).toThrow(/not your address/);
  });

  it("rejects a negative declared amount", () => {
    const tx = fixture({ outputs: [out(0, "launch-fee", -1n, null)] });
    expect(() => verifyWalletTransaction(tx, WALLET)).toThrow(/negative amount/);
  });

  it("accepts a declared change that returns to the wallet", () => {
    const tx = fixture({ outputs: [out(0, "change", 1_000n, WALLET)] });
    expect(() => verifyWalletTransaction(tx, WALLET)).not.toThrow();
  });

  it("rejects a real PSBT whose value does not match the declared output", () => {
    const psbt = buildUnsignedPsbt({
      network: "signet",
      inputs: [{ txid: "b".repeat(64), vout: 0, scriptPubKeyHex: "0014" + "aa".repeat(20), valueSats: 1_000_000n, confirmations: 6 }],
      outputs: [
        { script: opReturnScriptData(Buffer.from("x")), valueSats: 0n },
        { script: Buffer.from("0014" + "22".repeat(20), "hex"), valueSats: 10_000n },
      ],
      changeAddress: CHANGE_ADDRESS,
      feeRateSatVb: 2n,
      maxFeeRateSatVb: 50n,
      maxMinerFeeSats: 50_000n,
    });
    const actual = decodeUnsignedOutputs(psbt.unsignedHex);
    const declared = actual.map((a, i) => out(i, i === 0 ? "unknown" : "launch-fee", a.valueSats, null));
    // Tamper the declared second output value → mismatch must throw.
    declared[1] = out(1, "launch-fee", actual[1]!.valueSats + 1n, null);
    const tx = fixture({ network: "test", psbtBase64: psbt.psbtBase64, outputs: declared });
    expect(() => verifyWalletTransaction(tx, WALLET)).toThrow(/value/);
  });

  it("accepts a real PSBT whose outputs match the declared outputs", () => {
    const psbt = buildUnsignedPsbt({
      network: "signet",
      inputs: [{ txid: "b".repeat(64), vout: 0, scriptPubKeyHex: "0014" + "aa".repeat(20), valueSats: 1_000_000n, confirmations: 6 }],
      outputs: [
        { script: opReturnScriptData(Buffer.from("x")), valueSats: 0n },
        { script: Buffer.from("0014" + "22".repeat(20), "hex"), valueSats: 10_000n },
      ],
      changeAddress: CHANGE_ADDRESS,
      feeRateSatVb: 2n,
      maxFeeRateSatVb: 50n,
      maxMinerFeeSats: 50_000n,
    });
    const actual = decodeUnsignedOutputs(psbt.unsignedHex);
    const declared = actual.map((a, i) => out(i, i === 0 ? "unknown" : "launch-fee", a.valueSats, null));
    const tx = fixture({ network: "test", psbtBase64: psbt.psbtBase64, outputs: declared });
    expect(() => verifyWalletTransaction(tx, WALLET)).not.toThrow();
  });
});
