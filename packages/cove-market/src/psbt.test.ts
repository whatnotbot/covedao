import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { buildTransferPsbtV2 } from "@crclaunch/cove-guardian/v3";
import { unsignedTxDigest, partialSigOfInput, validateP2wpkhPartialSig } from "./psbt.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);
const seller = ECPair.fromPrivateKey(Buffer.alloc(32, 0x46));
const buyer = ECPair.fromPrivateKey(Buffer.alloc(32, 0x49));
const p2wpkh = (k: typeof seller) =>
  bitcoin.payments.p2wpkh({ pubkey: k.publicKey, network: bitcoin.networks.regtest }).output!;

describe("unsigned-tx digest + PSBT mutation detection (§12)", () => {
  function build(): bitcoin.Psbt {
    const tokenId = Buffer.alloc(32, 0x0a);
    return buildTransferPsbtV2({
      network: bitcoin.networks.regtest,
      tokenId,
      tokenInputs: [{ txid: "11".repeat(32), vout: 0, script: p2wpkh(seller), valueSats: 1000n }],
      tokenInputTotalAtoms: 1000n,
      tokenOutputs: [{ script: p2wpkh(buyer), amountAtoms: 1000n }],
      funderInputs: [{ txid: "22".repeat(32), vout: 0, script: p2wpkh(buyer), valueSats: 50_000n }],
      funderChangeScript: p2wpkh(buyer),
      btcOutputs: [{ script: p2wpkh(seller), valueSats: 40_000n }],
      minerFeeSats: 1000n,
    }).psbt;
  }

  it("digest is stable across signing stages and detects output mutation", () => {
    const psbt = build();
    const d1 = unsignedTxDigest(psbt);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);

    // Signing adds witness/partial-sig data but must NOT change the digest.
    psbt.signInput(0, seller);
    expect(unsignedTxDigest(psbt)).toBe(d1);
    psbt.signInput(1, buyer);
    expect(unsignedTxDigest(psbt)).toBe(d1);

    // Mutating an output changes the digest.
    const mutated = build();
    mutated.addOutput({ script: p2wpkh(buyer), value: 1000 });
    expect(unsignedTxDigest(mutated)).not.toBe(d1);
  });

  it("partial-sig validation accepts SIGHASH_ALL and rejects tampering", () => {
    const psbt = build();
    psbt.signInput(1, buyer);
    expect(partialSigOfInput(psbt, 1)).not.toBeNull();
    expect(() => validateP2wpkhPartialSig(psbt, 1)).not.toThrow();
    // Unsigned input must be rejected.
    expect(() => validateP2wpkhPartialSig(psbt, 0)).toThrow(/no partial signature/);
  });

  it("rejects a structurally-valid but cryptographically-wrong signature (§M1)", () => {
    const psbt = build();
    psbt.signInput(1, buyer);
    // Replace the buyer's partial sig with a VALID DER signature over a DIFFERENT
    // message signed by the SAME key — the old `() => true` validator accepted this.
    const wrongSig = bitcoin.script.signature.encode(buyer.sign(Buffer.alloc(32, 0xaa)), bitcoin.Transaction.SIGHASH_ALL);
    psbt.data.inputs[1]!.partialSig![0]!.signature = wrongSig;
    expect(() => validateP2wpkhPartialSig(psbt, 1)).toThrow(/signature invalid/);
  });
});
