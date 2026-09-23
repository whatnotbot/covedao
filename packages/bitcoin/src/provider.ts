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

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  bestBlockHash: string;
}

export interface BitcoinChainProvider {
  getBestHeight(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlock(hash: string): Promise<BitcoinBlock>;
  getRawTransaction(txid: string): Promise<string>;
  getBlockchainInfo(): Promise<BlockchainInfo>;
  /** Fetch + resolve DIRECT prevout script/value for each input (no recursion). */
  getTransaction(txid: string): Promise<BitcoinProtocolTx>;
  /** Resolve a single prevout (previous tx output) by txid:vout. */
  getPrevout(txid: string, vout: number): Promise<ChainUtxo | undefined>;
  getUtxos(scriptOrAddress: string): Promise<ChainUtxo[]>;
  broadcastTransaction(hex: string): Promise<string>;
  testMempoolAccept(hex: string, maxFeeRateSatVb?: bigint): Promise<{ allowed: boolean; rejectReason?: string }>;
  estimateFeeRate(): Promise<bigint>;
}

interface RpcConfig {
  url: string;
  user?: string;
  password?: string;
  /** Optional fee-rate ceiling (sat/vB) applied to estimation and broadcast. */
  maxFeeRateSatVb?: bigint;
}

/**
 * Convert Bitcoin Core's `estimatesmartfee.feerate` (BTC/kvB) to sat/vB.
 * sat/vB = BTC/kvB × 100,000 (1 BTC = 1e8 sats; 1 kvB = 1000 vB).
 * Pure helper so the conversion is unit-testable without an RPC.
 */
export function btcPerKvbToSatPerVb(btcPerKvb: number): bigint {
  if (!Number.isFinite(btcPerKvb) || btcPerKvb <= 0) return 2n;
  return BigInt(Math.max(1, Math.round(btcPerKvb * 100_000)));
}

/** Bitcoin Core JSON-RPC provider (deterministic full-node-backed indexing). */
export class CoreRpcProvider implements BitcoinChainProvider {
  private id = 0;
  private decodedCache = new Map<string, BitcoinProtocolTx>();
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
      signal: AbortSignal.timeout(20_000),
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

  async getBlockchainInfo(): Promise<BlockchainInfo> {
    const info = await this.call<{ chain: string; blocks: number; bestblockhash: string }>(
      "getblockchaininfo",
    );
    return { chain: info.chain, blocks: info.blocks, bestBlockHash: info.bestblockhash };
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
    // Verify the parsed block is the one requested and its merkle root matches.
    if (block.getId() !== hash) throw new Error(`Block hash mismatch: requested ${hash}, got ${block.getId()}`);
    const transactions = block.transactions ?? [];
    const mutated = { value: false };
    const actualMerkleRoot = bitcoin.Block.calculateMerkleRoot(transactions, false, mutated);
    if (mutated.value || !block.merkleRoot!.equals(actualMerkleRoot)) {
      throw new Error("Block merkle root mismatch.");
    }
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

  /** Decode a raw transaction (cached; correctness never depends on the cache). */
  private async getDecodedTransaction(txid: string): Promise<BitcoinProtocolTx> {
    const cached = this.decodedCache.get(txid);
    if (cached) return cached;
    const raw = await this.getRawTransaction(txid);
    const tx = decodeRawTransaction(raw);
    if (this.decodedCache.size >= 10_000) this.decodedCache.clear(); // bound memory
    this.decodedCache.set(txid, tx);
    return tx;
  }

  /** Resolve a single prevout without recursing into its ancestors. */
  async getPrevout(txid: string, vout: number): Promise<ChainUtxo | undefined> {
    const prev = await this.getDecodedTransaction(txid);
    const out = prev.outputs[vout];
    if (!out) return undefined;
    return {
      txid,
      vout,
      scriptPubKeyHex: out.scriptPubKeyHex,
      valueSats: out.valueSats,
      confirmations: 0, // unknown; caller derives from height if needed
    };
  }

  async getTransaction(txid: string): Promise<BitcoinProtocolTx> {
    const tx = await this.getDecodedTransaction(txid);
    // Resolve DIRECT prevouts only — never recursively walk ancestry.
    for (const input of tx.inputs) {
      if (input.prevTxid === "0".repeat(64)) continue; // coinbase
      const prevOut = await this.getPrevout(input.prevTxid, input.vout);
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
    // Pass an explicit maxfeerate (BTC/kvB) so a buggy node cannot relay a
    // wildly over-paying tx on our behalf.
    const maxfeerate = this.cfg.maxFeeRateSatVb ? Number(this.cfg.maxFeeRateSatVb) / 100_000 : undefined;
    return this.call<string>("sendrawtransaction", maxfeerate === undefined ? [hex] : [hex, maxfeerate]);
  }

  /**
   * Preflight a raw transaction against the mempool policy before broadcasting.
   * Returns a structured result rather than throwing, so callers can surface
   * the node's rejection reason.
   */
  async testMempoolAccept(hex: string, maxFeeRateSatVb?: bigint): Promise<{ allowed: boolean; rejectReason?: string }> {
    const maxfeerate = (maxFeeRateSatVb ?? this.cfg.maxFeeRateSatVb) ? Number(maxFeeRateSatVb ?? this.cfg.maxFeeRateSatVb) / 100_000 : undefined;
    const res = await this.call<{ allowed: boolean; "reject-reason"?: string }[]>(
      "testmempoolaccept",
      maxfeerate === undefined ? [[hex]] : [[hex, maxfeerate]],
    );
    const r = res?.[0];
    if (!r) return { allowed: false, rejectReason: "no result" };
    return { allowed: r.allowed, rejectReason: r["reject-reason"] };
  }

  async estimateFeeRate(): Promise<bigint> {
    // estimatesmartfee returns an OBJECT { feerate (BTC/kvB), blocks, errors? }.
    const res = await this.call<{ feerate?: number; errors?: string[] }>("estimatesmartfee", [2]);
    const btcPerKvb = res?.feerate;
    let rate: bigint;
    if (typeof btcPerKvb !== "number" || !Number.isFinite(btcPerKvb) || btcPerKvb <= 0) {
      rate = 2n; // fallback: 2 sat/vB
    } else {
      rate = btcPerKvbToSatPerVb(btcPerKvb); // sat/vB = BTC/kvB × 100,000
    }
    // Clamp to the caller-supplied ceiling (do not trust the node).
    if (this.cfg.maxFeeRateSatVb && rate > this.cfg.maxFeeRateSatVb) {
      return this.cfg.maxFeeRateSatVb;
    }
    return rate;
  }
}
