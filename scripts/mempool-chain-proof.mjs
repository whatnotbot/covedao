// Drive N backing buys through the real HTTP API with NO mining in between.
// Before unconfirmed chaining, buyer #2 onward got QUOTE_STALE.
const BASE = "http://localhost:3100";
const RPC = "http://127.0.0.1:18443";
const AUTH = "Basic " + Buffer.from("user:pass").toString("base64");

async function rpc(method, params = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: AUTH },
    body: JSON.stringify({ jsonrpc: "1.0", id: "1", method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
async function api(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const dev = (b) => api("/api/dev/wallet", b);

const IDENT = "alice";
const N = Number(process.argv[2] ?? 6);

const w = await api(`/api/dev/wallet?identity=${IDENT}`);
if (!w.ok) throw new Error("dev wallet off: " + JSON.stringify(w));
const { address, script } = w.data;

const toks = await api("/api/v3/tokens");
const token = toks.data?.[0];
if (!token) throw new Error("no token indexed — run the E2E first");
console.log(`token ${token.ticker}  supply ${BigInt(token.issuedSupplyAtoms) / 100000000n}`);
console.log(`buyer ${IDENT} ${address}\n`);

const results = [];
let pendingChange = null;
for (let i = 1; i <= N; i++) {
  try {
    const amountAtoms = (10_000_000n * 100_000_000n).toString();
    const q = await api("/api/v3/backing/buy/quote", { tokenId: token.tokenId, amountAtoms });
    if (!q.ok) throw new Error("quote: " + q.error.code);

    // A real wallet spends its own unconfirmed change. scantxoutset only sees
    // confirmed outputs, so after the first buy we follow the change ourselves.
    let funding;
    if (pendingChange) {
      funding = [pendingChange];
    } else {
      const u = await dev({ action: "getUtxos", identity: IDENT });
      funding = u.data.utxos;
    }
    const b = await api("/api/v3/backing/buy/build", {
      tokenId: token.tokenId,
      amountAtoms,
      walletScript: script,
      walletAddress: address,
      funding,
      minerFeeSats: "1200",
      quoteBinding: q.data,
      idempotencyKey: `chain-${i}-${Date.now()}`,
    });
    if (!b.ok) throw new Error("build: " + b.error.code);

    const signed = await dev({ action: "signPsbt", identity: IDENT, psbtBase64: b.data.psbtBase64 });
    const s = await api("/api/v3/backing/buy/submit", {
      sessionId: b.data.sessionId,
      signedPsbtBase64: signed.data.signedPsbtBase64,
    });
    if (!s.ok) throw new Error("submit: " + s.error.code);
    // Locate our change output in the broadcast transaction (skip the
    // 1,000-sat token carrier) so the next buy can chain onto it.
    const rawHex = await rpc("getrawtransaction", [s.data.txid]);
    const decoded = await rpc("decoderawtransaction", [rawHex]);
    pendingChange = null;
    for (const o of decoded.vout) {
      const spk = o.scriptPubKey?.hex ?? "";
      const sats = Math.round(o.value * 1e8);
      if (spk === script && sats > 1000) pendingChange = { txid: s.data.txid, vout: o.n };
    }
    results.push({ i, ok: true, txid: s.data.txid });
    console.log(`  buy #${String(i).padStart(2)}  OK   ${s.data.txid.slice(0, 16)}…`);
  } catch (e) {
    results.push({ i, ok: false, err: String(e.message) });
    console.log(`  buy #${String(i).padStart(2)}  FAIL ${e.message}`);
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n  ${ok}/${N} accepted into the SAME block (no mining between)`);

const info = await rpc("getmempoolinfo");
console.log(`  mempool holds ${info.size} transactions`);
await rpc("generatetoaddress", [1, await rpc("getnewaddress")]);
console.log("  mined 1 block");
await new Promise((r) => setTimeout(r, 6000));
const after = await api(`/api/v3/tokens/${token.tokenId}`);
console.log(`  supply now ${BigInt(after.data.issuedSupplyAtoms) / 100000000n} tokens`);
console.log(`  backing now ${after.data.backingSats} sats`);
