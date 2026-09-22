import type { Sats } from "@crclaunch/curve";

export interface BitcoinTx {
  txid: string;
  hex: string;
  blockHeight: bigint | null;
  confirmations: number;
  status: "MEMPOOL" | "CONFIRMED" | "UNKNOWN";
}

export interface Utxo {
  txid: string;
  vout: number;
  address: string;
  amountSats: Sats;
  confirmations: number;
}

export interface FeeEstimates {
  /** sats per vByte. All integers. */
  fastestSatVb: bigint;
  halfHourSatVb: bigint;
  hourSatVb: bigint;
  minimumSatVb: bigint;
}

/** A generic node-ish view the mock chain can satisfy (avoids a protocol dep). */
export interface BitcoinNodeLike {
  getHeight(): Promise<bigint>;
  getBlockHash(height: bigint): Promise<string>;
  getTx(txid: string): Promise<BitcoinTx | null>;
  getUtxos(address: string): Promise<Utxo[]>;
  getFeeEstimates(): Promise<FeeEstimates>;
  submitRawTx(rawTx: string): Promise<string>;
}

/**
 * Bitcoin L1 provider abstraction. A single external API outage must not take
 * down read-only application state; consumers may configure a fallback.
 */
export interface BitcoinProvider {
  getHeight(): Promise<bigint>;
  getBlockHash(height: bigint): Promise<string>;
  getTransaction(txid: string): Promise<BitcoinTx>;
  getUtxos(address: string): Promise<Utxo[]>;
  getFeeEstimates(): Promise<FeeEstimates>;
  broadcast(rawTx: string): Promise<string>;
}
