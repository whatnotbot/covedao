import { describe, expect, it } from "vitest";
import { decodeRawTransaction, type ChainUtxo } from "@crclaunch/bitcoin";
import { buildCoveDeployPsbt, buildCoveMintPsbt, buildCoveTransferPsbt } from "./build.js";
import { COVE_V1_SIGNET_CONFIG } from "./config.js";
import { decodeCoveEnvelope } from "./envelope.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const RECIPIENT = "5120" + "bb".repeat(32); // P2TR
const RECIPIENT2 = "0014" + "cc".repeat(20); // P2WPKH
const ACTOR = "0014" + "aa".repeat(20); // P2WPKH
const CHANGE_ADDR = "tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa";

const input: ChainUtxo = {
  txid: "a".repeat(64),
  vout: 0,
  scriptPubKeyHex: ACTOR,
  valueSats: 1_000_000n,
  confirmations: 6,
};

describe("Cove PSBT builders", () => {
  it("builds DEPLOY (OP_RETURN + 10,000 launch fee + change)", () => {
    const psbt = buildCoveDeployPsbt({
      network: "signet",
      ticker: "FROG",
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
      config: CFG,
    });
    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    const [o0, o1] = tx.outputs;
    expect(o0!.opReturnData).toBeDefined();
    expect(decodeCoveEnvelope(o0!.opReturnData!)).toEqual({ ok: true, envelope: { op: "deploy", tick: "FROG" } });
    expect(o1!.valueSats).toBe(10_000n);
    expect(o1!.scriptPubKeyHex).toBe(CFG.treasuryScript);
  });

  it("builds MINT (combined settlement = 1010 sats, no dust outputs)", () => {
    const psbt = buildCoveMintPsbt({
      network: "signet",
      ticker: "FROG",
      amountAtoms: 200_000_000_000_000n, // 2M tokens → 1000 curve + 10 fee
      supplyBeforeAtoms: 0n,
      recipientScriptHex: RECIPIENT,
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
      config: CFG,
    });
    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    const [o0, o1, o2] = tx.outputs;
    expect(decodeCoveEnvelope(o0!.opReturnData!).envelope).toEqual({
      op: "mint",
      tick: "FROG",
      amt: 200_000_000_000_000n,
      s: 0n,
    });
    expect(o1!.valueSats).toBe(330n); // P2TR recipient dust-safe
    expect(o1!.scriptPubKeyHex).toBe(RECIPIENT);
    expect(o2!.valueSats).toBe(1010n); // combined curve+fee
    expect(o2!.scriptPubKeyHex).toBe(CFG.settlementScript);
    // settlement (1010) is above dust (294 P2WPKH) — no dust protocol output.
    expect(o2!.valueSats).toBeGreaterThan(294n);
  });

  it("rejects below-minimum-contribution mint", () => {
    expect(() =>
      buildCoveMintPsbt({
        network: "signet",
        ticker: "FROG",
        amountAtoms: 100_000_000_000_000n, // 1M tokens → 500 sats < 1000
        supplyBeforeAtoms: 0n,
        recipientScriptHex: RECIPIENT,
        inputs: [input],
        changeAddress: CHANGE_ADDR,
        feeRateSatVb: 2n,
        config: CFG,
      }),
    ).toThrow(/BELOW_MIN_CONTRIBUTION/);
  });

  it("builds TRANSFER (recipient anchor + actor continuation)", () => {
    const psbt = buildCoveTransferPsbt({
      network: "signet",
      ticker: "FROG",
      amountAtoms: 50_000_000_000_000n,
      recipientScriptHex: RECIPIENT2,
      actorScriptHex: ACTOR,
      inputs: [input],
      changeAddress: CHANGE_ADDR,
      feeRateSatVb: 2n,
    });
    const tx = decodeRawTransaction(psbt.unsignedHex, "signet");
    const [o0, o1, o2] = tx.outputs;
    expect(decodeCoveEnvelope(o0!.opReturnData!).envelope).toEqual({
      op: "transfer",
      tick: "FROG",
      amt: 50_000_000_000_000n,
    });
    expect(o1!.valueSats).toBe(294n); // P2WPKH recipient dust-safe
    expect(o1!.scriptPubKeyHex).toBe(RECIPIENT2);
    expect(o2!.valueSats).toBe(294n); // P2WPKH actor continuation dust-safe
    expect(o2!.scriptPubKeyHex).toBe(ACTOR);
  });
});
