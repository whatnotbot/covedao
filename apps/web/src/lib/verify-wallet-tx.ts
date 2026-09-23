import { decodePsbtOutputs, scriptToAddress, type NetworkName } from "@crclaunch/bitcoin";
import type { UnsignedProtocolTransaction } from "@crclaunch/protocol";

function networkToBitcoin(network: string): NetworkName {
  if (network === "mainnet") return "mainnet";
  if (network === "regtest") return "regtest";
  // signet / mutinynet / testnet / test all share testnet address encodings.
  return "signet";
}

/**
 * Client-side verification of a wallet transaction BEFORE signing. The server
 * is untrusted: a hostile or compromised backend could return a transaction
 * whose change output is redirected to an attacker, or whose PSBT bytes do not
 * match the outputs it declared. The browser must refuse to sign anything it
 * cannot independently reconcile with the user's own address.
 *
 * In mock mode `psbtBase64` is a JSON envelope (not a bitcoinjs PSBT), so the
 * raw-PSBT re-verification is skipped — nothing real is at risk there. A real
 * wallet adapter MUST pass a real PSBT and hit the decode-and-compare path.
 */
export function verifyWalletTransaction(tx: UnsignedProtocolTransaction, walletAddress: string): void {
  // 1. Declared outputs must be sane, and any change must return to the wallet.
  for (const out of tx.outputs) {
    if (out.amountSats < 0n) {
      throw new Error(`Output ${out.index} has a negative amount (${out.amountSats})`);
    }
    if (out.kind === "change" && out.address !== walletAddress) {
      throw new Error(`Change output ${out.index} goes to ${out.address ?? "(null)"}, not your address ${walletAddress}`);
    }
  }

  // 2. When a REAL PSBT is present, decode it and verify every output against
  //    the declared outputs (value + address, in order).
  if (tx.psbtBase64 && tx.network !== "mock") {
    const net = networkToBitcoin(tx.network);
    const actual = decodePsbtOutputs(tx.psbtBase64, net);
    if (actual.length !== tx.outputs.length) {
      throw new Error(`PSBT has ${actual.length} outputs, but ${tx.outputs.length} were declared`);
    }
    for (let i = 0; i < actual.length; i++) {
      const a = actual[i]!;
      const d = tx.outputs[i]!;
      if (a.valueSats !== d.amountSats) {
        throw new Error(`PSBT output ${i} value ${a.valueSats} sats != declared ${d.amountSats} sats`);
      }
      if (d.address) {
        const addr = scriptToAddress(a.scriptPubKeyHex, net);
        if (addr !== d.address) {
          throw new Error(`PSBT output ${i} address ${addr ?? "(none)"} != declared ${d.address}`);
        }
      }
    }
  }
}
