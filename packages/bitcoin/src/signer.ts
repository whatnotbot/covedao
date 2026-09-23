import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { btcNetwork, type NetworkName } from "./decoder.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

/**
 * Minimal wallet/signer interface (item 32). No seed-phrase handling and no
 * server-side keys — this is a CLIENT-side test signer for signet.
 */
export interface WalletSigner {
  getNetwork(): NetworkName;
  getAddress(): string;
  getPublicKeyHex(): string;
  /** Sign + finalize a PSBT, returning the fully-signed raw transaction hex. */
  signPsbt(psbtBase64: string): Promise<string>;
}

/**
 * A local P2WPKH signer backed by a WIF test key. Used to build + sign real
 * Bitcoin signet Cove transactions end-to-end in tests/demos without any
 * browser wallet. The indexer/server never sees the key.
 */
export class LocalP2WPKHSigner implements WalletSigner {
  private readonly keyPair: ReturnType<typeof ECPair.fromWIF>;
  private readonly network: NetworkName;

  constructor(wif: string, network: NetworkName = "signet") {
    this.network = network;
    this.keyPair = ECPair.fromWIF(wif, btcNetwork(network));
  }

  /** Generate a fresh secure-random P2WPKH signer (never print the WIF). */
  static makeRandom(network: NetworkName = "signet"): LocalP2WPKHSigner {
    const kp = ECPair.makeRandom({ network: btcNetwork(network) });
    return new LocalP2WPKHSigner(kp.toWIF(), network);
  }

  /** Export the WIF (caller must write it to a secure owner-controlled file). */
  toWIF(): string {
    return this.keyPair.toWIF();
  }

  getNetwork(): NetworkName {
    return this.network;
  }

  getAddress(): string {
    const net = btcNetwork(this.network);
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: this.keyPair.publicKey, network: net });
    return p2wpkh.address!;
  }

  getPublicKeyHex(): string {
    return this.keyPair.publicKey.toString("hex");
  }

  async signPsbt(psbtBase64: string): Promise<string> {
    const net = btcNetwork(this.network);
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: net });
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const input = psbt.data.inputs[i]!;
      // Sign P2WPKH inputs we can satisfy (witnessUtxo present, ECDSA key).
      if (input.witnessUtxo) {
        try {
          psbt.signInput(i, this.keyPair);
        } catch {
          /* not this key's input */
        }
      }
    }
    psbt.finalizeAllInputs();
    return psbt.extractTransaction().toHex();
  }
}
