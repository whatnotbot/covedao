import type { Network } from "@crclaunch/config";

export interface WalletConnection {
  adapterId: string;
  /** Payment address (P2WPKH / P2TR). */
  address: string;
  network: Network;
  publicKey?: string;
}

export interface WalletAddresses {
  payment: string;
  /** Taproot/ordinals address, when the wallet distinguishes one. */
  ordinals?: string;
  change?: string;
}

/**
 * Wallet abstraction. Business code only ever calls this interface; injected
 * wallet globals are only touched inside adapter packages (apps/web/lib/wallets).
 */
export interface WalletAdapter {
  readonly id: string;
  connect(): Promise<WalletConnection>;
  disconnect(): Promise<void>;
  getAddresses(): Promise<WalletAddresses>;
  signPsbt(psbt: string): Promise<string>;
  signMessage?(message: string): Promise<string>;
}
