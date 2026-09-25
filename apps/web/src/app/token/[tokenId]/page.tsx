"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { verifyClientIntent } from "@crclaunch/wallets";
import { fmtBtc, fmtTokens, fmtInt, displayTokensToAtoms } from "@/lib/format";
import { DEMO_TOKEN_DETAIL, DEMO_LISTINGS } from "@/lib/demo-tokens";
import { TokenMarketPanel } from "@/components/TokenMarketPanel";
import { unitPriceSats } from "@/lib/ohlc";

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

function TokenContent() {
  const params = useParams<{ tokenId: string }>();
  const search = useSearchParams();
  // Client-side render path for design review. Never calls the API, never writes.
  const demo = search.get("demo") === "1";
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
    if (demo) {
      setDetail(DEMO_TOKEN_DETAIL as unknown as Detail);
      setLoaded(true);
      return;
    }
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
      // Offer BTC utxos for the miner fee. Token carriers are 1,000 sats each,
      // so without these a partial redeem from a single carrier cannot pay a
      // fee at all and larger redeems break above a few sat/vB.
      const redeemFunding = await getUtxos();
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
          funding: redeemFunding,
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

  if (!loaded) return <DetailSkeleton />;
  if (!detail) {
    return (
      <section className="panel px-6 py-16 text-center sm:px-10">
        <span className="chip chip-rejected">Not found</span>
        <div className="mt-4 text-bone">No such token</div>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-bone-dim">
          Nothing with this tokenId has confirmed on Bitcoin. A token appears here once its DEPLOY
          transaction is in a block.
        </p>
        <Link href="/explore" className="btn-ghost mt-5">Back to explore</Link>
      </section>
    );
  }

  const issued = BigInt(detail.issuedSupplyAtoms);
  const cap = BigInt(detail.publicCapAtoms);
  const pct = cap > 0n ? Number((issued * 10_000n) / cap) / 100 : 0;
  const graduated = (detail as { graduated?: boolean }).graduated ?? issued >= cap;

  // Open asks for this token, quoted in the same unit as the chart.
  const asks = (demo ? DEMO_LISTINGS.filter((l) => l.tokenId === detail.tokenId) : []).map((l) => ({
    unitPriceSats: unitPriceSats(l.amountAtoms, l.totalPriceSats),
    amountTokens: Number(BigInt(l.amountAtoms) / 100_000_000n),
    status: l.status,
  }));

  return (
    <div className="space-y-px">
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <section className="panel px-6 py-8 sm:px-10">
        {demo ? (
          <p className="mb-5 inline-block border border-pending/40 bg-pending/10 px-3 py-1.5 text-label uppercase tracking-label text-pending">
            Demo data · not from the chain
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Token</p>
            <h1 className="mt-3 text-4xl text-bone">{detail.ticker}</h1>
            <p className="mt-1 text-sm text-bone-dim">{detail.displayName}</p>
          </div>
          <span className={graduated ? "chip chip-signal" : "chip chip-verified"}>
            {graduated ? "Graduated" : "Open"}
          </span>
        </div>
        {detail.description ? (
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-bone-dim">{detail.description}</p>
        ) : null}

        {graduated ? (
          <div className="mt-6 border border-signal/40 bg-signal/10 px-5 py-4">
            <p className="text-label uppercase tracking-label text-signal">Graduated</p>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-bone-dim">
              The full 840M public curve has been minted. Minting is finished. The backing vault
              keeps buying and selling at the curve price exactly as before, so holders can still
              redeem at any time &mdash; graduation marks the milestone, it does not change how the
              token works.
            </p>
          </div>
        ) : null}

        {/* The curve is the single most important thing on this page. */}
        <div className="mt-8">
          <div className="flex items-baseline justify-between text-label uppercase tracking-label text-bone-dim">
            <span>Issued</span>
            <span>Stage {detail.curveStage} / 20</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-rule">
            <div className="h-1.5 bg-signal" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
            <span className="text-bone">{fmtTokens(issued)} <span className="text-bone-dim">({pct.toFixed(1)}%)</span></span>
            <span className="text-bone-dim">{fmtTokens(cap)} cap</span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
          <Tile value={fmtBtc(BigInt(detail.backingSats))} label="BTC backing" />
          <Tile value={fmtTokens(BigInt(detail.remainingCapacityAtoms))} label="Remaining" />
          <Tile value={fmtInt(detail.holderCount)} label="Holders" />
          <Tile
            value={detail.bestAskSats ? fmtBtc(BigInt(detail.bestAskSats)) : "—"}
            label={detail.activeListingCount ? `Best ask · ${detail.activeListingCount} listed` : "Best ask"}
          />
        </div>
      </section>

      {/* ── Market ───────────────────────────────────────────────────── */}
      <TokenMarketPanel
        tokenId={detail.tokenId}
        ticker={detail.ticker}
        curveStage={detail.curveStage}
        demo={demo}
        asks={asks}
        explorerBase={process.env.NEXT_PUBLIC_EXPLORER_URL}
      />

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <section className="panel px-6 py-8 sm:px-10">
        <p className="eyebrow">Trade</p>
        <div className="mt-5 grid gap-px bg-rule lg:grid-cols-[1fr_1.1fr]">
          <div className="bg-ink-3 px-5 py-5">
            <div className="flex flex-wrap">
              {(["buy", "sell", "transfer", "list"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "border border-signal bg-signal px-3 py-1.5 text-label uppercase tracking-label text-ink"
                      : "border border-rule px-3 py-1.5 text-label uppercase tracking-label text-bone-dim transition-colors hover:text-bone"
                  }
                >
                  {t === "buy" ? "Buy" : t === "sell" ? "Sell" : t === "transfer" ? "Transfer" : "List"}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs leading-relaxed text-bone-dim">
              {tab === "buy"
                ? "BTC enters the deterministic reserve; the curve decides the price. No oracle, no discretion."
                : tab === "sell"
                  ? "Redeem to the reserve for the exact R-delta, minus the protocol fee."
                  : tab === "transfer"
                    ? "Move tokens to another script. One Bitcoin transaction, settled on-chain."
                    : "List a real token UTXO at a fixed BTC price. Settles atomically when a buyer fills it."}
            </p>

            {!connected ? (
              <button onClick={() => void connect()} className="btn mt-5 w-full">
                Connect wallet
              </button>
            ) : (
              <div className="mt-5 space-y-4">
                {tab !== "list" && (
                  <label className="block">
                    <span className="eyebrow">Amount · display tokens</span>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="84000000"
                      className="field mt-2"
                    />
                  </label>
                )}
                {tab === "list" && (
                  <>
                    <label className="block">
                      <span className="eyebrow">Listed amount · atoms</span>
                      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000000" className="field mt-2" />
                    </label>
                    <label className="block">
                      <span className="eyebrow">Asking price · sats</span>
                      <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="41500" className="field mt-2" />
                    </label>
                  </>
                )}
                {tab === "transfer" && (
                  <label className="block">
                    <span className="eyebrow">Recipient scriptPubKey · hex</span>
                    <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0014…" className="field mt-2" />
                  </label>
                )}
                <button
                  onClick={tab === "buy" ? buy : tab === "sell" ? sell : tab === "transfer" ? transfer : list}
                  disabled={busy}
                  className="btn w-full"
                >
                  {busy
                    ? "Working…"
                    : tab === "buy"
                      ? "Buy from backing"
                      : tab === "sell"
                        ? "Redeem to backing"
                        : tab === "transfer"
                          ? "Transfer"
                          : "Sign & create listing"}
                </button>
              </div>
            )}

            {msg ? (
              <p className="mt-4 border border-verified/40 bg-verified/10 px-3 py-2 text-xs text-verified">{msg}</p>
            ) : null}
            {err ? (
              <p className="mt-4 border border-rejected/40 bg-rejected/10 px-3 py-2 text-xs text-rejected">{err}</p>
            ) : null}
            {txid ? <p className="hex mt-2">{txid}</p> : null}
          </div>

          {/* ── The verifiable facts. This is what separates Cove from a
                 dashboard: every one of these can be checked on-chain. ── */}
          <div className="bg-ink-3 px-5 py-5">
            <p className="eyebrow">On-chain record</p>
            <dl className="mt-4 space-y-3">
              <Fact k="Deploy txid" v={detail.deployTxid} mono />
              <Fact k="Deploy height" v={fmtInt(Number(detail.deployHeight))} />
              <Fact k="Backing outpoint" v={`${detail.backingOutpoint.txid}:${detail.backingOutpoint.vout}`} mono />
              <Fact k="State hash" v={detail.stateHash} mono />
              <Fact k="Policy version" v={`V${detail.policyVersion}`} />
              <Fact k="tokenId" v={detail.tokenId} mono />
            </dl>
            <p className="mt-5 text-xs leading-relaxed text-bone-dim">
              Every value above is derivable from confirmed blocks. Run the indexer and you should
              reach the same state hash.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="tile">
      <div className="text-lg tabular-nums text-bone">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-label text-bone-dim">{k}</dt>
      <dd className={mono ? "hex mt-1 text-bone-2" : "mt-1 text-sm tabular-nums text-bone-2"}>{v}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="panel px-6 py-8 sm:px-10">
      <div className="h-3 w-16 animate-pulse bg-rule-bright" />
      <div className="mt-4 h-9 w-40 animate-pulse bg-rule-bright" />
      <div className="mt-2 h-3 w-28 animate-pulse bg-rule" />
      <div className="mt-8 h-1.5 w-full bg-rule" />
      <div className="mt-8 grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-ink-3 px-4 py-5">
            <div className="h-5 w-24 animate-pulse bg-rule" />
            <div className="mt-2 h-2.5 w-16 animate-pulse bg-rule" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * useSearchParams opts this route into client-side rendering, which Next
 * requires to sit behind a Suspense boundary.
 */
export default function TokenPage() {
  return (
    <Suspense fallback={<div className="panel px-6 py-16 text-center text-sm text-bone-dim">Loading…</div>}>
      <TokenContent />
    </Suspense>
  );
}
