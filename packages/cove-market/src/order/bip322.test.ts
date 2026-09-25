import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import { bip322MessageHash, signBip322P2tr, signBip322P2wpkh, verifyBip322 } from "./signature.js";

// Test vectors from BIP-322 itself: what real wallets produce.
const P2WPKH = bitcoin.address.toOutputScript("bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l", bitcoin.networks.bitcoin);
const P2TR = bitcoin.address.toOutputScript("bc1ppv609nr0vr25u07u95waq5lucwfm6tde4nydujnu8npg4q75mr5sxq8lt3", bitcoin.networks.bitcoin);

describe("BIP-322 simple (wallet-compatible)", () => {
  it("hashes messages as the BIP specifies", () => {
    expect(bip322MessageHash("").toString("hex")).toBe("c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1");
    expect(bip322MessageHash("Hello World").toString("hex")).toBe("f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a");
  });

  it("accepts the BIP's P2WPKH vectors", () => {
    expect(verifyBip322(P2WPKH, "", "AkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=")).toBe(true);
    expect(verifyBip322(P2WPKH, "Hello World", "AkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=")).toBe(true);
  });

  it("accepts the BIP's P2TR vector", () => {
    expect(verifyBip322(P2TR, "Hello World", "AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==")).toBe(true);
  });

  it("a signature for one message never verifies for another (no replay)", () => {
    const sig = "AkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";
    expect(verifyBip322(P2WPKH, "COVE_MARKET_CANCEL_V1:anything", sig)).toBe(false);
    expect(verifyBip322(P2TR, "Hello World", sig)).toBe(false);
  });

  it("round-trips our own P2WPKH and P2TR signers", () => {
    const priv = Buffer.alloc(32, 0x46);
    const { scriptPubKey: tr, signatureB64 } = signBip322P2tr(priv, "listing");
    expect(verifyBip322(tr, "listing", signatureB64)).toBe(true);
    expect(verifyBip322(tr, "other", signatureB64)).toBe(false);

    const wpkh = bitcoin.payments.p2wpkh({ pubkey: Buffer.from("02" + "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5", "hex") }).output!;
    // Private key 2 → public key 2G, which is the pubkey above.
    const sig = signBip322P2wpkh(Buffer.concat([Buffer.alloc(31), Buffer.from([2])]), wpkh, "m");
    expect(verifyBip322(wpkh, "m", sig)).toBe(true);
  });

  it("rejects garbage without throwing", () => {
    expect(verifyBip322(P2WPKH, "x", "")).toBe(false);
    expect(verifyBip322(P2WPKH, "x", "not base64 at all!!")).toBe(false);
    expect(verifyBip322(Buffer.from("76a914" + "00".repeat(20) + "88ac", "hex"), "x", "AA==")).toBe(false);
  });
});
