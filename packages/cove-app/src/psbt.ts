import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import { checkSpendSignature, unfinalizeKeyInputs } from "@crclaunch/bitcoin";
import { AppError } from "./errors.js";

/** sha256 of the canonical UNSIGNED transaction bytes. */
export function unsignedTxDigest(psbt: bitcoin.Psbt): string {
  return createHash("sha256").update(psbt.data.globalMap.unsignedTx.toBuffer()).digest("hex");
}

export function parsePsbt(b64: string, network: bitcoin.networks.Network): bitcoin.Psbt {
  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(b64, { network });
  } catch (e) {
    throw new AppError("PSBT_MUTATED", `cannot parse PSBT: ${(e as Error).message}`);
  }
  unfinalizeKeyInputs(psbt);
  return psbt;
}

/**
 * bitcoinjs network parameters for a Cove network name.
 *
 * Signet and testnet share testnet's parameters (same bech32 prefix, same
 * version bytes), so they map together. Mainnet must map to `bitcoin`: this
 * previously fell through to testnet, which would have built every mainnet
 * PSBT and address against the wrong parameters.
 */
export function btcNetwork(network: string): bitcoin.networks.Network {
  if (network === "regtest") return bitcoin.networks.regtest;
  if (network === "mainnet") return bitcoin.networks.bitcoin;
  return bitcoin.networks.testnet;
}

/**
 * Validate a wallet's signature on one input.
 *
 * Handles every address kind a supported wallet hands out: native segwit,
 * nested segwit and Taproot key-path. This previously accepted only an ECDSA
 * `partialSig`, which meant a Xverse or Magic Eden payment address (nested
 * segwit) and every ordinals address (Taproot) were unsignable — most wallets
 * could not complete a single trade.
 */
export function validateInputSignature(psbt: bitcoin.Psbt, inputIndex: number): void {
  const result = checkSpendSignature(psbt, inputIndex);
  if (!result.ok) throw new AppError("WALLET_SIGNATURE_INVALID", result.detail);
}

/**
 * Net satoshis a wallet gains (+) or loses (−) across a PSBT, counting every
 * script the wallet owns.
 *
 * This is the one number a user actually cares about, and it is measured from
 * the transaction rather than assembled from the parts, so it cannot drift out
 * of step with what will be broadcast. The client re-derives the same figure
 * from the price it was shown and refuses to sign if the two disagree.
 */
export function walletDeltaSats(psbt: bitcoin.Psbt, walletScriptsHex: string | string[]): bigint {
  // A wallet is TWO addresses — payments and ordinals — so both count as
  // "mine". Counting only the payment script would read the 1,000 sats riding
  // on a token carrier as money leaving the wallet.
  const mine = new Set(
    (Array.isArray(walletScriptsHex) ? walletScriptsHex : [walletScriptsHex]).map((s) =>
      s.toLowerCase(),
    ),
  );
  const into = psbt.txOutputs.reduce(
    (sum, out) => (mine.has(out.script.toString("hex")) ? sum + BigInt(out.value) : sum),
    0n,
  );
  const outOf = psbt.data.inputs.reduce(
    (sum, input) =>
      input.witnessUtxo && mine.has(input.witnessUtxo.script.toString("hex"))
        ? sum + BigInt(input.witnessUtxo.value)
        : sum,
    0n,
  );
  return into - outOf;
}
