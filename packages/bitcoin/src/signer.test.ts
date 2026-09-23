import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import { LocalP2WPKHSigner, psbtIntent } from "./signer.js";
import { buildUnsignedPsbt, opReturnScriptData } from "./psbt.js";

// Deterministic test actor key (privkey = 32×0x42). Never fund it.
const ACTOR_WIF = "cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW";
const ACTOR_SCRIPT = "001414db4138d56a2ecfb10881a9be394d9f321985b2";

const OP_RETURN = opReturnScriptData(Buffer.from("COVEV1", "utf8"));
const TREASURY = Buffer.from("0014" + "22".repeat(20), "hex");

function build(outputs: { script: Uint8Array; valueSats: bigint }[], changeAddress = signer.getAddress()) {
  return buildUnsignedPsbt({
    network: "signet",
    inputs: [{ txid: "b".repeat(64), vout: 0, scriptPubKeyHex: ACTOR_SCRIPT, valueSats: 1_000_000n, confirmations: 6 }],
    outputs,
    changeAddress,
    feeRateSatVb: 2n,
    maxFeeRateSatVb: 50n,
    maxMinerFeeSats: 50_000n,
  });
}

const signer = new LocalP2WPKHSigner(ACTOR_WIF, "signet");
const attacker = LocalP2WPKHSigner.makeRandom("signet");
const attackerScript = bitcoin.address.toOutputScript(attacker.getAddress(), bitcoin.networks.testnet).toString("hex");

// Base DEPLOY-shaped PSBT: OP_RETURN + treasury + change.
const base = build([
  { script: OP_RETURN, valueSats: 0n },
  { script: TREASURY, valueSats: 10_000n },
]);
const intent = psbtIntent(base.unsignedHex, {
  maxFeeSats: 50_000n,
  changeScriptPubKeyHex: base.changeSats > 0n ? ACTOR_SCRIPT : undefined,
});

describe("LocalP2WPKHSigner.signPsbt (no blind signing)", () => {
  it("signs a PSBT whose outputs match the declared intent", async () => {
    const signedHex = await signer.signPsbt(base.psbtBase64, intent);
    expect(signedHex).toMatch(/^020000000001/);
  });

  it("refuses a hostile PSBT sweeping funds to an attacker (auditor PoC)", async () => {
    // 1 input → 1 attacker output (no change); caller's intent declares 3 outputs.
    const hostile = build([{ script: Buffer.from(attackerScript, "hex"), valueSats: 999_000n }]);
    await expect(signer.signPsbt(hostile.psbtBase64, intent)).rejects.toThrow(/output/);
  });

  it("refuses a wrong amount on a declared output", async () => {
    const wrong = build([
      { script: OP_RETURN, valueSats: 0n },
      { script: TREASURY, valueSats: 20_000n }, // declared 10_000
    ]);
    await expect(signer.signPsbt(wrong.psbtBase64, intent)).rejects.toThrow(/output\[1\] mismatch/);
  });

  it("refuses an extra output", async () => {
    const extra = build([
      { script: OP_RETURN, valueSats: 0n },
      { script: TREASURY, valueSats: 10_000n },
      { script: Buffer.from(attackerScript, "hex"), valueSats: 5_000n },
    ]);
    await expect(signer.signPsbt(extra.psbtBase64, intent)).rejects.toThrow(/output count/);
  });

  it("refuses a missing output", async () => {
    const missing = build([{ script: OP_RETURN, valueSats: 0n }]);
    await expect(signer.signPsbt(missing.psbtBase64, intent)).rejects.toThrow(/output count/);
  });

  it("refuses reordered outputs", async () => {
    const reordered = build([
      { script: TREASURY, valueSats: 10_000n },
      { script: OP_RETURN, valueSats: 0n },
    ]);
    await expect(signer.signPsbt(reordered.psbtBase64, intent)).rejects.toThrow(/output\[0\] mismatch/);
  });

  it("refuses a fee over the declared cap", async () => {
    const tinyCap = psbtIntent(base.unsignedHex, { maxFeeSats: 1n, changeScriptPubKeyHex: ACTOR_SCRIPT });
    await expect(signer.signPsbt(base.psbtBase64, tinyCap)).rejects.toThrow(/fee .* exceeds/);
  });

  it("refuses a change output redirected to an attacker", async () => {
    // Same protocol outputs, but change goes to a different script than declared.
    const redirected = build(
      [
        { script: OP_RETURN, valueSats: 0n },
        { script: TREASURY, valueSats: 10_000n },
      ],
      attacker.getAddress(), // wrong change address
    );
    await expect(signer.signPsbt(redirected.psbtBase64, intent)).rejects.toThrow(/output/);
  });
});
