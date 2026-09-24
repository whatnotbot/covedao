/** Bitcoin network a wallet adapter is connected to. */
export type WalletNetwork = "regtest" | "signet" | "testnet" | "mainnet";

export interface WalletCapabilities {
  psbt: boolean;
  bip322Simple: boolean;
  p2wpkh: boolean;
  p2tr: boolean;
  utxoDiscovery: boolean;
}

export interface WalletConnection {
  adapterId: string;
  network: WalletNetwork;
  /** UX address. */
  paymentAddress: string;
  /** Canonical scriptPubKey (hex) used for security-sensitive ownership checks. */
  paymentScript: string;
  publicKey?: string;
  capabilities: WalletCapabilities;
}

export interface WalletAddresses {
  payment: string;
  paymentScript: string;
  ordinals?: string;
  ordinalsScript?: string;
  change?: string;
  changeScript?: string;
}

export interface SignPsbtParams {
  psbtBase64: string;
  /** Optional subset of input indexes to sign; defaults to wallet-owned inputs. */
  inputIndexes?: number[];
  operation: string;
}

export interface SignBip322Params {
  message: string;
  /** Optional address whose script should authorize the message. */
  address?: string;
}

/**
 * Wallet abstraction. Business code only calls this interface; injected
 * provider-specific browser wallets are isolated in adapter files and must not
 * leak provider quirks into the generic application.
 */
export interface WalletAdapter {
  readonly id: string;
  detect(): boolean | Promise<boolean>;
  connect(): Promise<WalletConnection>;
  disconnect(): Promise<void>;
  getAddresses(): Promise<WalletAddresses>;
  getCapabilities(): Promise<WalletCapabilities>;
  signPsbt(params: SignPsbtParams): Promise<string>;
  signBip322Simple?(params: SignBip322Params): Promise<string>;
  getUtxos?(): Promise<{ txid: string; vout: number; valueSats: bigint }[]>;
}
