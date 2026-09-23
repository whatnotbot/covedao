import * as bitcoin from "bitcoinjs-lib";
import { btcNetwork, type NetworkName } from "./decoder.js";

export type { NetworkName } from "./decoder.js";

/**
 * Lightweight PSBT/output decoding helpers for CLIENT-side use.
 *
 * This module deliberately imports ONLY bitcoinjs-lib and the decoder — never
 * tiny-secp256k1 — so a browser bundle (Next.js/webpack) can import it without
 * pulling in the secp256k1 WASM module. The signing path (signer.ts) lives
 * elsewhere and does pull in the ECC library.
 */

export interface PsbtDecodeOutput {
  scriptPubKeyHex: string;
  valueSats: bigint;
}

/** Decode the outputs of a (real) PSBT base64 string. */
export function decodePsbtOutputs(psbtBase64: string, network: NetworkName = "signet"): PsbtDecodeOutput[] {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNetwork(network) });
  return psbt.txOutputs.map((o) => ({
    scriptPubKeyHex: o.script.toString("hex"),
    valueSats: BigInt(o.value),
  }));
}

/** Derive a display address for a standard output script, or undefined. */
export function scriptToAddress(scriptPubKeyHex: string, network: NetworkName = "signet"): string | undefined {
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptPubKeyHex, "hex"), btcNetwork(network));
  } catch {
    return undefined;
  }
}
