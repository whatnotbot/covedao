import * as bitcoin from "bitcoinjs-lib";

/**
 * Client-side transaction-intent verification (§23). The user must never be
 * asked to sign a PSBT the server returned without independently re-checking it
 * against the human-readable intent. This module is ECC-free and browser-safe
 * (it only parses + hashes; signing lives in e2e-signer.ts for the test harness).
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
  return bitcoin.crypto.sha256(psbt.data.globalMap.unsignedTx.toBuffer()).toString("hex");
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
