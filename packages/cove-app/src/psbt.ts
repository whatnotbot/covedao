import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { AppError } from "./errors.js";

/** sha256 of the canonical UNSIGNED transaction bytes. */
export function unsignedTxDigest(psbt: bitcoin.Psbt): string {
  return createHash("sha256").update(psbt.data.globalMap.unsignedTx.toBuffer()).digest("hex");
}

export function parsePsbt(b64: string, network: bitcoin.networks.Network): bitcoin.Psbt {
  try {
    return bitcoin.Psbt.fromBase64(b64, { network });
  } catch (e) {
    throw new AppError("PSBT_MUTATED", `cannot parse PSBT: ${(e as Error).message}`);
  }
}

export function btcNetwork(network: string): bitcoin.networks.Network {
  return network === "regtest" ? bitcoin.networks.regtest : bitcoin.networks.testnet;
}

/** Validate a P2WPKH input's partial sig is SIGHASH_ALL and cryptographically valid. */
export function validateInputSignature(psbt: bitcoin.Psbt, inputIndex: number): void {
  const input = psbt.data.inputs[inputIndex];
  if (!input || !input.partialSig || input.partialSig.length === 0) {
    throw new AppError("WALLET_SIGNATURE_INVALID", `input ${inputIndex} unsigned`);
  }
  const sig = Buffer.from(input.partialSig[0]!.signature);
  if (sig.length === 0 || sig[sig.length - 1] !== bitcoin.Transaction.SIGHASH_ALL) {
    throw new AppError("WALLET_SIGNATURE_INVALID", `input ${inputIndex} not SIGHASH_ALL`);
  }
  let ok = false;
  try {
    ok = psbt.validateSignaturesOfInput(inputIndex, (pubkey, msghash, sig) => ecc.verify(msghash, pubkey, sig));
  } catch {
    ok = false;
  }
  if (!ok) throw new AppError("WALLET_SIGNATURE_INVALID", `input ${inputIndex} signature invalid`);
}
