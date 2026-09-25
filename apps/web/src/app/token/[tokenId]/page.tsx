"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { verifyClientIntent } from "@crclaunch/wallets";
import { fmtBtc, fmtTokens, displayTokensToAtoms } from "@/lib/format";

interface Detail {
  tokenId: string;
  ticker: string;
  displayName: string;
  description: string;
  deployTxid: string;
  deployHeight: string;
  policyVersion: number;
  issuedSupplyAtoms: string;
  publicCapAtoms: string;
  remainingCapacityAtoms: string;
  backingSats: string;
  backingOutpoint: { txid: string; vout: number };
  stateHash: string;
  curveStage: number;
  holderCount: number;
  bestAskSats: string | null;
  activeListingCount: number;
}

export default function TokenPage() {
  const params = useParams<{ tokenId: string }>();
  const tokenId = params.tokenId;
  const { connected, address, script, connect, signPsbt, signBip322, getUtxos } = useWallet();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"buy" | "sell" | "transfer" | "list">("buy");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState("");

  useEffect(() => {
    void fetch(`/api/v3/tokens/${tokenId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setDetail(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tokenId]);

  async function buy() {
    if (!detail || !connected) return;
    setErr("");
    setBusy(true);
    try {
      const qr = await fetch("/api/v3/backing/buy/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, amountAtoms: displayTokensToAtoms(amount) }),
      });
      const qj = await qr.json();
      if (!qj.ok) throw new Error(qj.error?.message ?? "quote failed");
      const funding = await getUtxos();
      const br = await fetch("/api/v3/backing/buy/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network: "regtest",
          tokenId,
          amountAtoms: displayTokensToAtoms(amount),
          quoteBinding: { stateHash: qj.data.stateHash, backingOutpoint: qj.data.backingOutpoint, expiresAtHeight: qj.data.expiresAtHeight },
          walletScript: script,
          walletAddress: address,
          funding,
          minerFeeSats: "1000",
          idempotencyKey: `buy-${tokenId}-${Date.now()}`,
        }),
      });
      const bj = await br.json();
      if (!bj.ok) throw new Error(bj.error?.message ?? "build failed");
      verifyClientIntent(bj.data.psbtBase64, bj.data.intent);
      const signed = await signPsbt(bj.data.psbtBase64, "BACKING_BUY");
      const sr = await fetch("/api/v3/backing/buy/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: bj.data.sessionId, signedPsbtBase64: signed }),
      });
      const sj = await sr.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "submit failed");
      setTxid(sj.data.txid);
      setMsg(`Buy broadcast ${sj.data.txid.slice(0, 16)}…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sell() {
    if (!detail || !connected) return;
    setErr("");
    setBusy(true);
    try {
      const qr = await fetch("/api/v3/backing/redeem/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, amountAtoms: displayTokensToAtoms(amount) }),
      });
      const qj = await qr.json();
      if (!qj.ok) throw new Error(qj.error?.message ?? "quote failed");
      const br = await fetch("/api/v3/backing/redeem/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network: "regtest",
          tokenId,
          amountAtoms: displayTokensToAtoms(amount),
          walletScript: script,
          walletAddress: address,
          minerFeeSats: "1000",
          idempotencyKey: `redeem-${tokenId}-${Date.now()}`,
        }),
      });
      const bj = await br.json();
      if (!bj.ok) throw new Error(bj.error?.message ?? "build failed");
      verifyClientIntent(bj.data.psbtBase64, bj.data.intent);
      const signed = await signPsbt(bj.data.psbtBase64, "REDEEM");
      const sr = await fetch("/api/v3/backing/redeem/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: bj.data.sessionId, signedPsbtBase64: signed }),
      });
      const sj = await sr.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "submit failed");
      setTxid(sj.data.txid);
      setMsg(`Redeem broadcast ${sj.data.txid.slice(0, 16)}…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!detail || !connected) return;
    setErr("");
    setBusy(true);
    try {
      const funding = await getUtxos();
      const br = await fetch("/api/v3/transfer/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network: "regtest",
          tokenId,
          amountAtoms: displayTokensToAtoms(amount),
          recipientScript: recipient,
          walletScript: script,
          walletAddress: address,
          funding,
          minerFeeSats: "1000",
          idempotencyKey: `transfer-${tokenId}-${Date.now()}`,
        }),
      });
      const bj = await br.json();
      if (!bj.ok) throw new Error(bj.error?.message ?? "build failed");
      verifyClientIntent(bj.data.psbtBase64, bj.data.intent);
      const signed = await signPsbt(bj.data.psbtBase64, "TRANSFER");
      const sr = await fetch("/api/v3/transfer/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: bj.data.sessionId, signedPsbtBase64: signed }),
      });
      const sj = await sr.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "submit failed");
      setTxid(sj.data.txid);
      setMsg(`Transfer broadcast ${sj.data.txid.slice(0, 16)}…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function list() {
    if (!detail || !connected) return;
    setErr("");
    setBusy(true);
    try {
      // list from the wallet's first token UTXO for this token (simple single-UTXO path)
      const pf = await fetch(`/api/v3/wallet/${address}/portfolio`).then((r) => r.json());
      const utxo = pf.data?.tokenUtxos?.find((u: { tokenId: string }) => u.tokenId === tokenId);
      if (!utxo) throw new Error("No token UTXO to list");
      const pr = await fetch("/api/v3/market/listings/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenId,
          sourceTxid: utxo.txid,
          sourceVout: String(utxo.vout),
          amountAtoms: amount,
          totalPriceSats: price,
          expiryHeight: "1000000",
          walletScript: script,
        }),
      });
      const pj = await pr.json();
      if (!pj.ok) throw new Error(pj.error?.message ?? "prepare listing failed");
      const sig = await signBip322(pj.data.message);
      const cr = await fetch("/api/v3/market/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing: pj.data.listing, signatureB64: sig }),
      });
      const cj = await cr.json();
      if (!cj.ok) throw new Error(cj.error?.message ?? "create listing failed");
      setMsg(`Listing created ${cj.data.listingId.slice(0, 16)}…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="text-bone-dim">Loading token…</div>;
  if (!detail) return <div className="text-bone-dim">Token not found.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-bone">{detail.displayName} <span className="text-bone-dim">${detail.ticker}</span></h1>
        <p className="mt-1 break-all font-mono text-xs text-bone-dim">tokenId {detail.tokenId}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 border border-rule bg-ink-2 p-5 text-sm">
          <h2 className="text-bone">Backing & supply</h2>
          <KV k="Issued public supply" v={fmtTokens(BigInt(detail.issuedSupplyAtoms))} />
          <KV k="Public cap" v={fmtTokens(BigInt(detail.publicCapAtoms))} />
          <KV k="Remaining capacity" v={fmtTokens(BigInt(detail.remainingCapacityAtoms))} />
          <KV k="BTC backing" v={fmtBtc(BigInt(detail.backingSats))} />
          <KV k="Curve stage" v={String(detail.curveStage)} />
          <KV k="Holders" v={String(detail.holderCount)} />
          <KV k="Deploy txid" v={<span className="font-mono text-xs">{detail.deployTxid.slice(0, 16)}…</span>} />
        </div>

        <div className="border border-rule bg-ink-2 p-5">
          <div className="mb-4 flex gap-2 text-sm">
            {(["buy", "sell", "transfer", "list"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ?"bg-brand text-white" : "text-gray-400 hover:text-white"}`}>
                {t === "buy" ? "Buy" : t === "sell" ? "Instant Sell" : t === "transfer" ? "Transfer" : "List for Sale"}
              </button>
            ))}
          </div>
          {!connected ? (
            <button onClick={() => void connect()} className="w-full bg-signal px-6 py-3 text-bone hover:bg-[#F0A253]">Connect wallet</button>
          ) : (
            <div className="space-y-3">
              {tab !== "list" && (
                <label className="block">
                  <span className="text-xs text-bone-dim">{tab === "transfer" ? "Amount (display tokens)" : "Amount (whole display tokens)"}</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 84000000" className="mt-1 w-full border border-rule bg-bg px-4 py-2 text-sm text-bone outline-none focus:border-brand" />
                </label>
              )}
              {tab === "list" && (
                <>
                  <label className="block">
                    <span className="text-xs text-bone-dim">Listed amount (atoms)</span>
                    <input value={amount} placeholder="Listed amount (atoms)" onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full border border-rule bg-bg px-4 py-2 text-sm text-bone outline-none focus:border-brand" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-bone-dim">Total asking price (sats)</span>
                    <input value={price} placeholder="Total asking price (sats)" onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full border border-rule bg-bg px-4 py-2 text-sm text-bone outline-none focus:border-brand" />
                  </label>
                </>
              )}
              {tab === "transfer" && (
                <label className="block">
                  <span className="text-xs text-bone-dim">Recipient scriptPubKey (hex)</span>
                  <input value={recipient} placeholder="Recipient scriptPubKey" onChange={(e) => setRecipient(e.target.value)} className="mt-1 w-full border border-rule bg-bg px-4 py-2 text-sm text-bone outline-none focus:border-brand" />
                </label>
              )}
              <button
                onClick={tab === "buy" ? buy : tab === "sell" ? sell : tab === "transfer" ? transfer : list}
                disabled={busy}
                className="w-full bg-signal px-6 py-3 text-bone hover:bg-[#F0A253] disabled:opacity-50"
              >
                {busy ? "Working…" : tab === "buy" ? "Buy from Backing" : tab === "sell" ? "Redeem to Backing" : tab === "transfer" ? "Transfer" : "Sign & Create Listing"}
              </button>
            </div>
          )}
          {msg && <p className="mt-3 text-sm text-success">{msg}</p>}
          {err && <p className="mt-3 text-sm text-danger">{err}</p>}
          {txid && <p className="mt-1 font-mono text-xs text-bone-dim">{txid}</p>}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-bone-dim">{k}</span>
      <span className="text-right text-bone">{v}</span>
    </div>
  );
}
