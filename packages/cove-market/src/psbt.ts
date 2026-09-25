import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { MarketError } from "./errors.js";

/**
 * PSBT coordinator helpers (§12/§13). The unsigned-tx digest is the ONE value
 * that must be byte-identical across the buyer-sign and seller-sign stages; it
 * hashes the canonical UNSIGNED transaction (outpoints, sequences, outputs,
 * version, locktime) — never the PSBT metadata or the accumulating signatures.
 */

export function unsignedTxDigest(psbt: bitcoin.Psbt): string {
  const unsignedTx = psbt.data.globalMap.unsignedTx;
  const bytes = unsignedTx.toBuffer();
  return createHash("sha256").update(bytes).digest("hex");
}

/** Sighash byte of a DER+hashtype signature (last byte). */
export function sighashTypeOf(sig: Buffer): number {
  if (sig.length === 0) throw new MarketError("UNSAFE_SIGHASH", "empty signature");
  return sig[sig.length - 1]!;
}

export function isSighashAll(sig: Buffer): boolean {
  return sighashTypeOf(sig) === bitcoin.Transaction.SIGHASH_ALL;
}

/** The single partial signature on a P2WPKH input, or null. */
export function partialSigOfInput(psbt: bitcoin.Psbt, inputIndex: number): Buffer | null {
  const input = psbt.data.inputs[inputIndex];
  if (!input || !input.partialSig || input.partialSig.length === 0) return null;
  return Buffer.from(input.partialSig[0]!.signature);
}

/** True when the input's scriptPubKey (witnessUtxo) is the P2WPKH of `pubkey`. */
export function inputMatchesPubkey(psbt: bitcoin.Psbt, inputIndex: number, pubkey: Buffer): boolean {
  const witnessUtxo = psbt.data.inputs[inputIndex]?.witnessUtxo;
  if (!witnessUtxo) return false;
  const expected = bitcoin.payments.p2wpkh({
    pubkey,
    network: (psbt as unknown as { network?: bitcoin.networks.Network }).network ?? bitcoin.networks.regtest,
  }).output;
  return !!expected && expected.equals(witnessUtxo.script);
}

/**
 * Validate a P2WPKH input's partial signature: must be present, SIGHASH_ALL,
 * and cryptographically valid against the witnessUtxo. Rejects ANYONECANPAY /
 * SINGLE / NONE outright (§13).
 */
export function validateP2wpkhPartialSig(psbt: bitcoin.Psbt, inputIndex: number): void {
  const sig = partialSigOfInput(psbt, inputIndex);
  if (!sig) throw new MarketError("BUYER_SIGNATURE_INVALID", `input ${inputIndex} has no partial signature`);
  if (!isSighashAll(sig)) throw new MarketError("UNSAFE_SIGHASH", `input ${inputIndex} is not SIGHASH_ALL`);
  let ok = false;
  try {
    ok = psbt.validateSignaturesOfInput(inputIndex, (pubkey, msghash, sig) => ecc.verify(msghash, pubkey, sig));
  } catch {
    ok = false;
  }
  if (!ok) throw new MarketError("BUYER_SIGNATURE_INVALID", `input ${inputIndex} signature invalid`);
}

export function parsePsbt(b64: string, network: bitcoin.networks.Network): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(b64, { network });
  } catch (e) {
    throw new MarketError("PSBT_MUTATED", `cannot parse PSBT: ${(e as Error).message}`);
  }
}
