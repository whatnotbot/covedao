import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { MarketError } from "../errors.js";
import type { CancellationV1, ListingV1 } from "../types.js";
import { cancellationMessageToSign, listingMessageToSign } from "./hash.js";

/**
 * BIP-322 seller authorization (§8). V1 supports P2WPKH (the fixture and the
 * common carrier case). P2TR key-path BIP-322 is a documented follow-up.
 */
bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

function isP2WPKH(scriptHex: string): boolean {
  return /^0014[0-9a-f]{40}$/i.test(scriptHex);
}

function compactSize(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}
function readCompactSize(buf: Buffer, offset: number): { value: number; len: number } {
  const first = buf[offset]!;
  if (first < 0xfd) return { value: first, len: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), len: 3 };
  return { value: buf.readUInt32LE(offset + 1), len: 5 };
}

/**
 * BIP-322 "simple" message commitment: the message is committed to as
 * SHA256(message) inside to_spend's first OP_RETURN output (§8).
 */
function commitmentScript(message: string): Buffer {
  const messageHash = bitcoin.crypto.sha256(Buffer.from(message, "utf8"));
  return bitcoin.script.compile([0x6a as number, messageHash]);
}

export function signBip322P2wpkh(privKey: Buffer, scriptPubKey: Buffer, message: string): string {
  const ECPair = ECPairFactory(ecc);
  const key = ECPair.fromPrivateKey(privKey);

  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptPubKey); // scriptSig = scriptPubKey
  toSpend.addOutput(commitmentScript(message), 0);
  toSpend.addOutput(scriptPubKey, 0);

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.addInput(toSpend.getHash(), 1, 0); // spends to_spend output 1 (the scriptPubKey)
  toSign.addOutput(bitcoin.script.compile([0x6a as number]), 0);

  const hashType = bitcoin.Transaction.SIGHASH_ALL;
  const sighash = toSign.hashForWitnessV0(0, scriptPubKey, 0, hashType);
  const sig = bitcoin.script.signature.encode(key.sign(Buffer.from(sighash)), hashType);
  toSign.setWitness(0, [sig, Buffer.from(key.publicKey)]);

  const ts = toSpend.toBuffer();
  const tn = toSign.toBuffer();
  return Buffer.concat([compactSize(ts.length), ts, compactSize(tn.length), tn]).toString("base64");
}

export function verifyBip322P2wpkh(scriptPubKey: Buffer, message: string, signatureB64: string): boolean {
  let full: Buffer;
  try {
    full = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }
  try {
    let offset = 0;
    const tsLen = readCompactSize(full, offset);
    offset += tsLen.len;
    const toSpend = bitcoin.Transaction.fromBuffer(full.subarray(offset, offset + tsLen.value));
    offset += tsLen.value;
    const tnLen = readCompactSize(full, offset);
    offset += tnLen.len;
    const toSign = bitcoin.Transaction.fromBuffer(full.subarray(offset, offset + tnLen.value));

    // to_spend structure: sentinel outpoint, output 0 = message commitment,
    // output 1 = the scriptPubKey being proven.
    if (!toSpend.outs[1] || !toSpend.outs[1].script.equals(scriptPubKey)) return false;
    if (!toSpend.outs[0] || !toSpend.outs[0].script.equals(commitmentScript(message))) return false;

    // to_sign structure: exactly one input spending to_spend output 1, and one OP_RETURN output.
    if (toSign.ins.length !== 1) return false;
    const witness = toSign.ins[0]?.witness;
    if (!witness || witness.length !== 2) return false;
    const sig = Buffer.from(witness[0]!);
    const pubkey = Buffer.from(witness[1]!);

    const decoded = bitcoin.script.signature.decode(sig);
    if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL) return false;

    const sighash = toSign.hashForWitnessV0(0, scriptPubKey, 0, decoded.hashType);
    return ecc.verify(Buffer.from(sighash), pubkey, decoded.signature);
  } catch {
    return false;
  }
}

/** Verify seller BIP-322 authorization against the exact listing message. */
export function verifyListingAuthorization(l: ListingV1, signatureB64: string): boolean {
  const scriptHex = l.sellerTokenScript;
  if (!isP2WPKH(scriptHex)) {
    throw new MarketError("LISTING_BAD_SIGNATURE", "V1 BIP-322 supports P2WPKH seller scripts only");
  }
  return verifyBip322P2wpkh(Buffer.from(scriptHex, "hex"), listingMessageToSign(l), signatureB64);
}

export function verifyCancellationAuthorization(
  l: ListingV1,
  c: CancellationV1,
  signatureB64: string,
): boolean {
  const scriptHex = l.sellerTokenScript;
  if (!isP2WPKH(scriptHex)) {
    throw new MarketError("LISTING_BAD_SIGNATURE", "V1 BIP-322 supports P2WPKH seller scripts only");
  }
  return verifyBip322P2wpkh(Buffer.from(scriptHex, "hex"), cancellationMessageToSign(c), signatureB64);
}
