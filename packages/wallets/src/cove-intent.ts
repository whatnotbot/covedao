import * as bitcoin from "bitcoinjs-lib";

/**
 * Client-side transaction-intent verification (§23/§M3). The user must never be
 * asked to sign a PSBT the server returned without independently re-checking it
 * against the human-readable intent. This module is ECC-free and browser-safe
 * (it only parses + hashes; signing lives in e2e-signer.ts for the test harness).
 *
 * §M3: the digest alone is NOT proof — it is a value the same server supplied
 * (circular). Every economically-relevant output is re-derived from the user's
 * own input and asserted against the PSBT: the miner fee, the protocol fee
 * output, and the wallet's own receive output (payout / carrier / change).
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

function bigintOr(s: string | null | undefined): bigint | null {
  if (s === null || s === undefined) return null;
  return BigInt(s);
}

/** Throws CLIENT_INTENT_MISMATCH when the PSBT diverges from the server intent. */
export function verifyClientIntent(psbtBase64: string, intent: ClientIntent, network: bitcoin.networks.Network = bitcoin.networks.regtest): VerifiedIntent {
  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  } catch {
    throw new Error("CLIENT_INTENT_MISMATCH: cannot parse PSBT");
  }

  // Structural integrity: the unsigned tx must byte-match the digest. This alone
  // cannot detect a hostile backend, so the output checks below are the real gate.
  const digest = unsignedTxDigestHex(psbt);
  if (digest !== intent.unsignedTxDigest) {
    throw new Error("CLIENT_INTENT_MISMATCH: unsigned transaction changed");
  }

  const totalInputSats = psbt.data.inputs.reduce((s, i) => s + BigInt(i.witnessUtxo?.value ?? 0), 0n);
  const totalOutputSats = psbt.txOutputs.reduce((s, o) => s + BigInt(o.value), 0n);

  // Miner fee exactness: the fee the user asked for must be the actual fee.
  const minerFee = totalInputSats - totalOutputSats;
  const expectedMinerFee = BigInt(intent.minerFeeSats);
  if (minerFee !== expectedMinerFee) {
    throw new Error(`CLIENT_INTENT_MISMATCH: miner fee ${minerFee} != expected ${expectedMinerFee}`);
  }

  const outputs = psbt.txOutputs.map((o, i) => ({ index: i, scriptHex: o.script.toString("hex"), value: BigInt(o.value) }));

  // Protocol fee: the quoted fee amount must appear as an output.
  const protocolFee = bigintOr(intent.protocolFeeSats);
  if (protocolFee !== null && protocolFee > 0n && !outputs.some((o) => o.value === protocolFee)) {
    throw new Error("CLIENT_INTENT_MISMATCH: protocol fee output missing");
  }

  // The wallet's own receive output. For a redeem the payout (netSats) must land
  // on the wallet script; for every other flow the wallet must receive an output
  // on its own script (token carrier and/or change).
  const net = bigintOr(intent.netSats);
  if (net !== null) {
    if (!outputs.some((o) => o.scriptHex === intent.walletScript && o.value === net)) {
      throw new Error("CLIENT_INTENT_MISMATCH: payout does not go to the wallet");
    }
  } else if (!outputs.some((o) => o.scriptHex === intent.walletScript)) {
    throw new Error("CLIENT_INTENT_MISMATCH: no output to the wallet");
  }

  return {
    ok: true,
    digest,
    inputCount: psbt.data.inputs.length,
    outputCount: psbt.txOutputs.length,
    totalInputSats,
    totalOutputSats,
  };
}
