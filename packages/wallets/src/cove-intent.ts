import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/**
 * Client-side transaction-intent verification (§23). The user must never be
 * asked to sign a PSBT the server returned without independently re-checking it
 * against the human-readable intent. This module recomputes the canonical
 * unsigned-transaction digest and (when a signing key is available) validates
 * the wallet-owned inputs' signatures before any wallet prompt.
 */

export interface ClientIntent {
  operation: string;
  tokenId: string | null;
  tokenAmountAtoms: string | null;
  grossSats: string | null;
  protocolFeeSats: string | null;
  minerFeeSats: string;
  netSats: string | null;
  walletScript: string;
  stateHash: string | null;
  unsignedTxDigest: string;
}

export function unsignedTxDigestHex(psbt: bitcoin.Psbt): string {
  return createHash("sha256").update(psbt.data.globalMap.unsignedTx.toBuffer()).digest("hex");
}

export interface VerifiedIntent {
  ok: true;
  digest: string;
  inputCount: number;
  outputCount: number;
  totalInputSats: bigint;
  totalOutputSats: bigint;
}

/** Throws CLIENT_INTENT_MISMATCH when the PSBT diverges from the server intent. */
export function verifyClientIntent(psbtBase64: string, intent: ClientIntent, network: bitcoin.networks.Network = bitcoin.networks.regtest): VerifiedIntent {
  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  } catch {
    throw new Error("CLIENT_INTENT_MISMATCH: cannot parse PSBT");
  }
  const digest = unsignedTxDigestHex(psbt);
  if (digest !== intent.unsignedTxDigest) {
    throw new Error("CLIENT_INTENT_MISMATCH: unsigned transaction changed");
  }
  const totalInputSats = psbt.data.inputs.reduce((s, i) => s + BigInt(i.witnessUtxo?.value ?? 0), 0n);
  const totalOutputSats = psbt.txOutputs.reduce((s, o) => s + BigInt(o.value), 0n);
  return {
    ok: true,
    digest,
    inputCount: psbt.data.inputs.length,
    outputCount: psbt.txOutputs.length,
    totalInputSats,
    totalOutputSats,
  };
}

const ECPair = ECPairFactory(ecc);

/** Sign every wallet-owned P2WPKH input of a PSBT with the given 32-byte key. */
export function signPsbtWithKey(psbtBase64: string, privKeyHex: string, network: bitcoin.networks.Network = bitcoin.networks.regtest): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  const key = ECPair.fromPrivateKey(Buffer.from(privKeyHex, "hex"), { network });
  const script = bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network }).output!;
  const indexes: number[] = [];
  psbt.data.inputs.forEach((input, i) => {
    if (input.witnessUtxo && input.witnessUtxo.script.equals(script) && !input.partialSig?.length) indexes.push(i);
  });
  for (const i of indexes) psbt.signInput(i, key);
  return psbt.toBase64();
}

/** BIP-322 simple-message signature (base64) over a P2WPKH script. */
export function signBip322WithKey(message: string, privKeyHex: string, network: bitcoin.networks.Network = bitcoin.networks.regtest): string {
  const key = ECPair.fromPrivateKey(Buffer.from(privKeyHex, "hex"), { network });
  const scriptPubKey = bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network }).output!;
  const messageHash = bitcoin.crypto.sha256(Buffer.from(message, "utf8"));

  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptPubKey);
  toSpend.addOutput(bitcoin.script.compile([0x6a, messageHash]), 0);
  toSpend.addOutput(scriptPubKey, 0);

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.addInput(toSpend.getHash(), 1, 0);
  toSign.addOutput(bitcoin.script.compile([0x6a]), 0);

  const sighash = toSign.hashForWitnessV0(0, scriptPubKey, 0, bitcoin.Transaction.SIGHASH_ALL);
  const sig = bitcoin.script.signature.encode(key.sign(Buffer.from(sighash)), bitcoin.Transaction.SIGHASH_ALL);
  toSign.setWitness(0, [sig, Buffer.from(key.publicKey)]);

  const ts = toSpend.toBuffer();
  const tn = toSign.toBuffer();
  const compactSize = (n: number): Buffer => (n < 0xfd ? Buffer.from([n]) : Buffer.concat([Buffer.from([0xfd]), (() => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; })()]));
  return Buffer.concat([compactSize(ts.length), ts, compactSize(tn.length), tn]).toString("base64");
}
