import type { WalletAdapter, WalletAddresses, WalletConnection } from "./types.js";

/**
 * Deterministic mock wallet for dev/tests. It does not hold any key material —
 * it only mints a fake address and appends a mock signature to a PSBT.
 */
export class MockWalletAdapter implements WalletAdapter {
  readonly id = "mock";
  private connected = false;
  private readonly address: string;

  constructor(address?: string) {
    // Deterministic, clearly-fake bech32-like address for mock mode.
    this.address =
      address ?? `bc1qm0ckwallet${Math.random().toString(16).slice(2, 10)}00000000`;
  }

  async connect(): Promise<WalletConnection> {
    this.connected = true;
    return {
      adapterId: this.id,
      address: this.address,
      network: "mock",
      publicKey: `mock-pub-${this.address.slice(0, 8)}`,
    };
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getAddresses(): Promise<WalletAddresses> {
    if (!this.connected) await this.connect();
    return { payment: this.address, ordinals: this.address };
  }

  async signPsbt(psbt: string): Promise<string> {
    if (!this.connected) await this.connect();
    // Mock signature: append a signed envelope marker. Never real crypto.
    return `${psbt}\nMOCK-SIGNED-BY:${this.address}`;
  }

  async signMessage(message: string): Promise<string> {
    return `mock-signature:${Buffer.from(message).toString("base64")}:${this.address}`;
  }
}
