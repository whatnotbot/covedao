import { describe, expect, it } from "vitest";
import { decodeRawTransaction, type ChainUtxo } from "@crclaunch/bitcoin";
import { buildCoveDeployPsbt, buildCoveMintPsbt, buildCoveTransferPsbt } from "./build.js";
import type { CoveConfig } from "./validator.js";

const TREASURY = "5120" + "11".repeat(32);
const RESERVE = "0014" + "22".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);
const CHANGE_ADDR = "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa";

const CFG: CoveConfig = {
  treasuryScript: TREASURY,
  reserveScript: RESERVE,
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  supportedScriptPrefixes: ["0014", "5120"],
};

const input: ChainUtxo = {
  txid: "a".repeat(64),
  vout: 0,
  scriptPubKeyHex: "0014" + "aa".repeat(20),
  valueSats: 1_000_000n,
  confirmations: 6,
};

describe("Cove PSBT builders", () => {
  it("builds a DEPLOY with OP_RETURN + exact launch fee + change", () => {
    const psbt = buildCoveDeployPsbt({
      network: "signet",
      ticker: "FROG",
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
      config: CFG,
    });
    expect(psbt.opReturnJson).toBe('{"p":"cove","v":1,"op":"deploy","tick":"FROG"}');

    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    expect(tx.outputs).toHaveLength(3); // OP_RETURN + launch fee + change
    expect(tx.outputs[0]!.opReturnData).toBeDefined();
    expect(tx.outputs[1]!.valueSats).toBe(10_000n);
    expect(tx.outputs[1]!.scriptPubKeyHex).toBe(TREASURY);
    expect(tx.outputs[2]!.valueSats).toBeGreaterThan(546n); // change
  });

  it("builds a MINT with recomputed curve (500) + fee (5) exactly", () => {
    const psbt = buildCoveMintPsbt({
      network: "signet",
      ticker: "FROG",
      amountTokens: 1_000_000n,
      supplyBeforeTokens: 0n,
      recipientScriptHex: RECIPIENT,
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
      config: CFG,
    });
    expect(psbt.opReturnJson).toBe(
      '{"p":"cove","v":1,"op":"mint","tick":"FROG","amt":"1000000","s":"0"}',
    );

    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    expect(tx.outputs).toHaveLength(5); // OP_RETURN + dust + curve + fee + change
    expect(tx.outputs[1]!.valueSats).toBe(546n);
    expect(tx.outputs[1]!.scriptPubKeyHex).toBe(RECIPIENT);
    expect(tx.outputs[2]!.valueSats).toBe(500n);
    expect(tx.outputs[2]!.scriptPubKeyHex).toBe(RESERVE);
    expect(tx.outputs[3]!.valueSats).toBe(5n);
    expect(tx.outputs[3]!.scriptPubKeyHex).toBe(TREASURY);
  });

  it("builds a TRANSFER with OP_RETURN + recipient dust + change", () => {
    const psbt = buildCoveTransferPsbt({
      network: "signet",
      ticker: "FROG",
      amountTokens: 100_000n,
      recipientScriptHex: RECIPIENT,
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
    });
    expect(psbt.opReturnJson).toBe(
      '{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"100000"}',
    );

    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    expect(tx.outputs).toHaveLength(3); // OP_RETURN + dust + change
    expect(tx.outputs[1]!.valueSats).toBe(546n);
    expect(tx.outputs[1]!.scriptPubKeyHex).toBe(RECIPIENT);
  });

  it("rejects a mint whose curve fee would exceed inputs", () => {
    const tiny: ChainUtxo = { ...input, valueSats: 100n };
    expect(() =>
      buildCoveMintPsbt({
        network: "signet",
        ticker: "FROG",
        amountTokens: 1_000_000n,
        supplyBeforeTokens: 0n,
        recipientScriptHex: RECIPIENT,
        inputs: [tiny],
        changeAddress: CHANGE_ADDR,
        feeRateSatVb: 2n,
        config: CFG,
      }),
    ).toThrow();
  });
});
