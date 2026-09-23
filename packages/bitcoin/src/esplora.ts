import * as bitcoin from "bitcoinjs-lib";
import type { ChainUtxo } from "./provider.js";
import { btcNetwork, type NetworkName } from "./decoder.js";

interface EsploraUtxoJson {
  txid: string;
  vout: number;
  value: number;
  status?: { confirmed: boolean; block_height?: number };
}

/**
 * Address-indexed UTXO source via a public Esplora HTTP API (blockstream.info
 * or mempool.space). Used to resolve REAL funding UTXOs for the signer — the
 * Core RPC `listunspent` path requires a wallet and must not remain a stub for
 * the test execution path.
 */
export class EsploraUtxoProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly network: NetworkName = "signet",
  ) {}

  async getUtxos(address: string, bestHeight: number): Promise<ChainUtxo[]> {
    const net = btcNetwork(this.network);
    const script = bitcoin.address.toOutputScript(address, net);
    const scriptHex = script.toString("hex");

    const res = await fetch(`${this.baseUrl}/address/${address}/utxo`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Esplora utxo HTTP ${res.status}`);
    const utxos = (await res.json()) as EsploraUtxoJson[];

    return utxos.map((u) => {
      const blockHeight = u.status?.block_height;
      const confirmations = u.status?.confirmed && blockHeight !== undefined ? bestHeight - blockHeight + 1 : 0;
      return {
        txid: u.txid,
        vout: u.vout,
        scriptPubKeyHex: scriptHex,
        valueSats: BigInt(Math.round(u.value)),
        confirmations: Math.max(0, confirmations),
      };
    });
  }
}
