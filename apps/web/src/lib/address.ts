import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { AppError } from "@crclaunch/cove-app";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/** Decode a Bitcoin address to its scriptPubKey (network-aware, checksum-enforced). */
export function addressToScript(address: string, network: "regtest" | "signet" | "testnet" | "mainnet"): string {
  const net = network === "mainnet" ? bitcoin.networks.bitcoin : network === "regtest" ? bitcoin.networks.regtest : bitcoin.networks.testnet;
  try {
    return bitcoin.address.toOutputScript(address, net).toString("hex");
  } catch {
    throw new AppError("WRONG_NETWORK", "invalid address for this network");
  }
}

/** Decode an address to an address string of the same script (checksummed). */
export function scriptToAddress(scriptHex: string, network: "regtest" | "signet" | "testnet" | "mainnet"): string | null {
  const net = network === "mainnet" ? bitcoin.networks.bitcoin : network === "regtest" ? bitcoin.networks.regtest : bitcoin.networks.testnet;
  try {
    return bitcoin.address.fromOutputScript(Buffer.from(scriptHex, "hex"), net);
  } catch {
    return null;
  }
}
