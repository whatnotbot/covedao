import type { WalletAdapter, WalletAddresses, WalletCapabilities, WalletConnection } from "./types.js";

/**
 * DEMO-ONLY mock wallet. Holds no key material, produces a fake address and
 * appends a mock signature marker. It MUST never auto-connect in production and
 * must never be used to authorize a real Cove transaction.
 */
export class MockWalletAdapter implements WalletAdapter {
  readonly id = "mock";
  private connected = false;
  private readonly address: string;

  constructor(address?: string) {
    this.address = address ?? `bc1qm0ckwallet${Math.random().toString(16).slice(2, 10)}00000000`;
  }

  detect(): boolean {
    return true;
  }

  async connect(): Promise<WalletConnection> {
    this.connected = true;
    return {
      adapterId: this.id,
      paymentAddress: this.address,
      paymentScript: "",
      network: "regtest",
      publicKey: `mock-pub-${this.address.slice(0, 8)}`,
      capabilities: { psbt: false, bip322Simple: false, p2wpkh: false, p2tr: false, utxoDiscovery: false },
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getAddresses(): Promise<WalletAddresses> {
    if (!this.connected) await this.connect();
    return { payment: this.address, paymentScript: "" };
  }

  async getCapabilities(): Promise<WalletCapabilities> {
    return { psbt: false, bip322Simple: false, p2wpkh: false, p2tr: false, utxoDiscovery: false };
  }

  async signPsbt(params: { psbtBase64: string }): Promise<string> {
    if (!this.connected) await this.connect();
    return `${params.psbtBase64}\nMOCK-SIGNED-BY:${this.address}`;
  }
}
