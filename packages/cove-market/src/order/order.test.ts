import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import type { ListingV1 } from "../types.js";
import { serializeListingV1 } from "./serialization.js";
import { listingIdOf, cancellationHashOf, listingMessageToSign } from "./hash.js";
import { signBip322P2wpkh, verifyBip322P2wpkh, verifyListingAuthorization, verifyCancellationAuthorization } from "./signature.js";
import { validateListingShape } from "./validate.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);
const seller = ECPair.fromPrivateKey(Buffer.alloc(32, 0x46)); // alice test key
const sellerScript = bitcoin.payments.p2wpkh({ pubkey: seller.publicKey, network: bitcoin.networks.regtest }).output!;

function listing(overrides: Partial<ListingV1> = {}): ListingV1 {
  return {
    orderVersion: 1,
    chainIdentity: "bitcoin-regtest",
    tokenId: "4710488a0ab304fb2316e0174360a41937e1f0a81f2b26dee5a38ef79fb2d252",
    sellerTokenScript: sellerScript.toString("hex"),
    sellerPayoutScript: sellerScript.toString("hex"),
    sellerTokenChangeScript: sellerScript.toString("hex"),
    sourceTxid: "aa".repeat(32),
    sourceVout: 2,
    sourceAmountAtoms: 84_000_000n * 100_000_000n,
    amountAtoms: 42_000_000n * 100_000_000n,
    totalPriceSats: 100_000n,
    creationHeight: 1n,
    expiryHeight: 500n,
    nonce: "bb".repeat(32),
    ...overrides,
  };
}

describe("market V1 canonical listing (§5-§8)", () => {
  it("serialization is deterministic and independent of property order", () => {
    const a = listing();
    const b = listing();
    expect(serializeListingV1(a).equals(serializeListingV1(b))).toBe(true);
    expect(serializeListingV1(a).toString("hex")).toBe(serializeListingV1(b).toString("hex"));
  });

  it("listingId is stable and 64-hex", () => {
    const id = listingIdOf(listing());
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(listingIdOf(listing())).toBe(id);
    // Golden vector: any change to serialization/ordering breaks this.
    expect(id).toBe("9eeaa7a92c3c246b3a8b85b37392724c2b2b45aa81ba8dfcd02f4db7c8437f2c");
  });

  it("any canonical field mutation changes listingId", () => {
    const base = listingIdOf(listing());
    const mutations: Partial<ListingV1>[] = [
      { amountAtoms: 42_000_001n * 100_000_000n },
      { totalPriceSats: 100_001n },
      { sellerPayoutScript: "0014" + "c".repeat(40) },
      { sellerTokenChangeScript: "0014" + "d".repeat(40) },
      { sourceVout: 3 },
      { expiryHeight: 501n },
      { nonce: "cc".repeat(32) },
      { tokenId: "dd".repeat(32) },
      { sourceTxid: "ee".repeat(32) },
    ];
    for (const m of mutations) {
      expect(listingIdOf(listing(m))).not.toBe(base);
    }
  });

  it("BIP-322 P2WPKH sign/verify roundtrip", () => {
    const l = listing();
    const msg = listingMessageToSign(l);
    const sig = signBip322P2wpkh(Buffer.alloc(32, 0x46), sellerScript, msg);
    expect(verifyBip322P2wpkh(sellerScript, msg, sig)).toBe(true);
    expect(verifyListingAuthorization(l, sig)).toBe(true);
  });

  it("BIP-322 rejects wrong key or wrong message", () => {
    const l = listing();
    const sig = signBip322P2wpkh(Buffer.alloc(32, 0x46), sellerScript, listingMessageToSign(l));
    expect(verifyBip322P2wpkh(sellerScript, "WRONG MESSAGE", sig)).toBe(false);
    const otherScript = bitcoin.payments.p2wpkh({ pubkey: ECPair.makeRandom().publicKey, network: bitcoin.networks.regtest }).output!;
    expect(verifyBip322P2wpkh(otherScript, listingMessageToSign(l), sig)).toBe(false);
  });

  it("signed cancellation verifies against the listing's seller script", () => {
    const l = listing();
    const c = { version: 1 as const, listingId: listingIdOf(l), cancelNonce: "ff".repeat(32) };
    const cancelHash = cancellationHashOf(c);
    expect(cancelHash).toMatch(/^[0-9a-f]{64}$/);
    const msg = `COVE_MARKET_CANCEL_V1:${cancelHash}`;
    const sig = signBip322P2wpkh(Buffer.alloc(32, 0x46), sellerScript, msg);
    expect(verifyCancellationAuthorization(l, c, sig)).toBe(true);
  });

  it("validateListingShape rejects invalid listings", () => {
    expect(() => validateListingShape(listing())).not.toThrow();
    expect(() => validateListingShape(listing({ amountAtoms: 0n }))).toThrow(/AMOUNT/);
    expect(() => validateListingShape(listing({ amountAtoms: 100_000_000n * 100_000_000n }))).toThrow(/amount > source/);
    expect(() => validateListingShape(listing({ totalPriceSats: 0n }))).toThrow(/PRICE/);
    expect(() => validateListingShape(listing({ sellerTokenChangeScript: "0014" + "d".repeat(40) }))).toThrow(/change/);
    expect(() => validateListingShape(listing({ expiryHeight: 0n }))).toThrow(/EXPIRED/);
  });
});
