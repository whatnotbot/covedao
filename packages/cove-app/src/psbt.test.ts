import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { validateInputSignature } from "./psbt.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function signedPsbt(): bitcoin.Psbt {
  const buyer = ECPair.fromPrivateKey(Buffer.alloc(32, 0x49));
  const script = bitcoin.payments.p2wpkh({ pubkey: buyer.publicKey, network: bitcoin.networks.regtest }).output!;
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
  psbt.addInput({ hash: "22".repeat(32), index: 0, witnessUtxo: { script, value: 50_000 } });
  psbt.addOutput({ script: Buffer.from("0014" + "c".repeat(20), "hex"), value: 49_000 });
  psbt.signInput(0, buyer);
  return psbt;
}

describe("validateInputSignature (§M1)", () => {
  it("accepts a valid SIGHASH_ALL partial signature", () => {
    const psbt = signedPsbt();
    expect(() => validateInputSignature(psbt, 0)).not.toThrow();
  });

  it("rejects a structurally-valid but cryptographically-wrong signature", () => {
    const psbt = signedPsbt();
    // Sign a DIFFERENT message with the SAME key and substitute it: valid DER,
    // SIGHASH_ALL, but wrong for the actual sighash.
    const wrongKey = ECPair.fromPrivateKey(Buffer.alloc(32, 0x49));
    const wrongSig = bitcoin.script.signature.encode(wrongKey.sign(Buffer.alloc(32, 0xbb)), bitcoin.Transaction.SIGHASH_ALL);
    psbt.data.inputs[0]!.partialSig![0]!.signature = wrongSig;
    expect(() => validateInputSignature(psbt, 0)).toThrow(/signature invalid/);
  });
});
