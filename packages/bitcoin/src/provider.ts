import * as bitcoin from "bitcoinjs-lib";
import { decodeRawTransaction, type BitcoinProtocolTx } from "./decoder.js";

export interface BitcoinBlock {
  hash: string;
  height: number;
  previousBlockHash: string;
  txids: string[];
  /** Raw transaction hexes, in canonical Bitcoin block order. */
  rawTxs: string[];
}

export interface ChainUtxo {
  txid: string;
  vout: number;
  scriptPubKeyHex: string;
  valueSats: bigint;
  confirmations: number;
}

export interface BitcoinChainProvider {
  getBestHeight(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlock(hash: string): Promise<BitcoinBlock>;
  getRawTransaction(txid: string): Promise<string>;
  /** Fetch + resolve prevout script/value for each input of the transaction. */
  getTransaction(txid: string): Promise<BitcoinProtocolTx>;
  getUtxos(scriptOrAddress: string): Promise<ChainUtxo[]>;
  broadcastTransaction(hex: string): Promise<string>;
  estimateFeeRate(): Promise<bigint>;
}

interface RpcConfig {
  url: string;
  user?: string;
  password?: string;
}

/** Bitcoin Core JSON-RPC provider (deterministic full-node-backed indexing). */
export class CoreRpcProvider implements BitcoinChainProvider {
  private id = 0;
  constructor(private readonly cfg: RpcConfig) {}

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.user !== undefined) {
      const token = Buffer.from(`${this.cfg.user}:${this.cfg.password ?? ""}`).toString("base64");
      headers.authorization = `Basic ${token}`;
    }
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }),
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message?: string } | null };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message ?? "error"}`);
    return json.result as T;
  }

  async getBestHeight(): Promise<number> {
    return this.call<number>("getblockcount");
  }

  async getBlockHash(height: number): Promise<string> {
    return this.call<string>("getblockhash", [height]);
  }

  async getBlock(hash: string): Promise<BitcoinBlock> {
    // Fetch the serialized block once (verbosity 0) and parse it locally with
    // bitcoinjs-lib — one RPC call yields every raw transaction, avoiding N+1
    // per-transaction lookups.
    const raw = await this.call<string>("getblock", [hash, 0]);
    const header = await this.call<{ height: number; previousblockhash?: string }>(
      "getblockheader",
      [hash],
    );
    const block = bitcoin.Block.fromHex(raw);
    const transactions = block.transactions ?? [];
    const txids = transactions.map((tx) => tx.getId());
    const rawTxs = transactions.map((tx) => tx.toHex());
    return {
      hash,
      height: header.height,
      previousBlockHash: header.previousblockhash ?? "",
      txids,
      rawTxs,
    };
  }

  async getRawTransaction(txid: string): Promise<string> {
    return this.call<string>("getrawtransaction", [txid, false]);
  }

  async getTransaction(txid: string): Promise<BitcoinProtocolTx> {
    const raw = await this.getRawTransaction(txid);
    const tx = decodeRawTransaction(raw);
    // Resolve prevout info for each input.
    for (const input of tx.inputs) {
      const prev = await this.getTransaction(input.prevTxid);
      const prevOut = prev.outputs[input.vout];
      if (prevOut) {
        input.prevScriptPubKeyHex = prevOut.scriptPubKeyHex;
        input.prevValueSats = prevOut.valueSats;
      }
    }
    return tx;
  }

  async getUtxos(): Promise<ChainUtxo[]> {
    // Core RPC requires a wallet for listunspent; not used for indexing.
    return [];
  }

  async broadcastTransaction(hex: string): Promise<string> {
    return this.call<string>("sendrawtransaction", [hex]);
  }

  async estimateFeeRate(): Promise<bigint> {
    const btcPerKvb = await this.call<number>("estimatesmartfee", [2]);
    if (typeof btcPerKvb !== "number" || !Number.isFinite(btcPerKvb)) return 2n;
    return BigInt(Math.max(1, Math.round(btcPerKvb * 100_000))); // sats/kvB
  }
}
