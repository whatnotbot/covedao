#!/usr/bin/env node
/**
 * A Bitcoin Core JSON-RPC front for an Esplora API, for TEST networks only.
 *
 * Mutinynet is a custom signet with 30-second blocks; stock Bitcoin Core
 * cannot follow it. Cove talks to a node over JSON-RPC, so this answers the
 * handful of calls Cove makes from https://mutinynet.com/api (or any Esplora).
 *
 * Trust: the Esplora server is trusted for chain data. Blocks are still
 * re-hashed and merkle-checked by Cove's own provider, but a lying server
 * could hide a spend or a block. Never point mainnet at this.
 *
 *   ESPLORA_URL=https://mutinynet.com/api PORT=38432 node scripts/esplora-rpc.mjs
 */
import http from "node:http";

const BASE = (process.env.ESPLORA_URL ?? "https://mutinynet.com/api").replace(/\/$/, "");
const PORT = Number(process.env.PORT ?? 38432);
const CHAIN = process.env.CHAIN_NAME ?? "signet";

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function get(path, as = "json") {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) throw new RpcError(-5, `not found: ${path}`);
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new RpcError(-1, `esplora ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    if (as === "json") return res.json();
    if (as === "hex") return Buffer.from(await res.arrayBuffer()).toString("hex");
    return (await res.text()).trim();
  }
}

// Small caches: the worker polls every couple of seconds.
let tipCache = { at: 0, height: 0, hash: "" };
async function tip() {
  if (Date.now() - tipCache.at < 3000) return tipCache;
  const [height, hash] = await Promise.all([get("/blocks/tip/height", "text"), get("/blocks/tip/hash", "text")]);
  tipCache = { at: Date.now(), height: Number(height), hash };
  return tipCache;
}
const hashByHeight = new Map();
const rawBlocks = new Map();

const methods = {
  async getblockcount() {
    return (await tip()).height;
  },
  async getbestblockhash() {
    return (await tip()).hash;
  },
  async getblockchaininfo() {
    const t = await tip();
    return { chain: CHAIN, blocks: t.height, headers: t.height, bestblockhash: t.hash, initialblockdownload: false };
  },
  async getblockhash([height]) {
    const t = await tip();
    if (height > t.height) throw new RpcError(-8, "Block height out of range");
    const cached = hashByHeight.get(height);
    if (cached) return cached;
    const hash = await get(`/block-height/${height}`, "text");
    if (height < t.height - 6) hashByHeight.set(height, hash);
    return hash;
  },
  async getblock([hash, verbosity = 1]) {
    if (verbosity !== 0) throw new RpcError(-8, "only verbosity 0 is served");
    if (!rawBlocks.has(hash)) {
      if (rawBlocks.size > 200) rawBlocks.clear();
      rawBlocks.set(hash, await get(`/block/${hash}/raw`, "hex"));
    }
    return rawBlocks.get(hash);
  },
  async getblockheader([hash]) {
    const b = await get(`/block/${hash}`);
    return { hash: b.id, height: b.height, previousblockhash: b.previousblockhash };
  },
  async getrawtransaction([txid]) {
    return get(`/tx/${txid}/hex`, "text");
  },
  async gettxout([txid, vout]) {
    let tx;
    try {
      tx = await get(`/tx/${txid}`);
    } catch (e) {
      if (e.code === -5) return null;
      throw e;
    }
    const out = tx.vout?.[vout];
    if (!out) return null;
    // Spent — including by an unconfirmed transaction — is gone, as in Core.
    const spend = await get(`/tx/${txid}/outspend/${vout}`);
    if (spend.spent) return null;
    const t = await tip();
    const confirmations = tx.status?.confirmed ? t.height - tx.status.block_height + 1 : 0;
    return {
      bestblock: t.hash,
      confirmations,
      value: out.value / 1e8,
      scriptPubKey: { hex: out.scriptpubkey, address: out.scriptpubkey_address },
      coinbase: false,
    };
  },
  async sendrawtransaction([hex]) {
    const res = await fetch(`${BASE}/tx`, { method: "POST", body: hex, signal: AbortSignal.timeout(20_000) });
    const text = (await res.text()).trim();
    if (!res.ok) throw new RpcError(-26, text.slice(0, 300));
    return text;
  },
  async testmempoolaccept([txs]) {
    const res = await fetch(`${BASE}/txs/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(txs),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.json();
    // Not every Esplora has the endpoint. Say yes; the broadcast itself is
    // still checked by the network and its error is returned to the user.
    return txs.map(() => ({ allowed: true }));
  },
  async estimatesmartfee([blocks]) {
    const est = await get("/fee-estimates");
    const keys = Object.keys(est).map(Number).sort((a, b) => a - b);
    const k = keys.find((x) => x >= blocks) ?? keys[keys.length - 1];
    const satPerVb = Math.max(1, est[k] ?? 1);
    return { feerate: satPerVb / 1e5, blocks: k };
  },
  async getmempoolinfo() {
    return { loaded: true, mempoolminfee: 0.00001, minrelaytxfee: 0.00001 };
  },
};

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let calls;
    try {
      calls = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const one = async (c) => {
      const fn = methods[c.method];
      if (!fn) return { id: c.id, result: null, error: { code: -32601, message: `Method not found: ${c.method}` } };
      try {
        return { id: c.id, result: await fn(c.params ?? []), error: null };
      } catch (e) {
        return { id: c.id, result: null, error: { code: e.code ?? -1, message: e.message } };
      }
    };
    const out = Array.isArray(calls) ? await Promise.all(calls.map(one)) : await one(calls);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`esplora-rpc: ${BASE} on 127.0.0.1:${PORT} (chain=${CHAIN})`));
