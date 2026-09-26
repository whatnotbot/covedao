"use client";

import { useSearchParams } from "next/navigation";

import { Suspense, useEffect, useState } from "react";
import { useIndexedHeight } from "@/lib/use-indexed-height";
import { useWallet } from "@/components/WalletProvider";
import { fmtBtc, fmtTokens } from "@/lib/format";
import { DEMO_PORTFOLIO } from "@/lib/demo-tokens";
import { verifyClientIntent } from "@crclaunch/wallets";
import { sendTokens } from "@/lib/trade";
import { displayTokensToAtoms } from "@/lib/format";
import { useFeeRates } from "@/components/FeePicker";

interface Portfolio {
  holdings: { tokenId: string; amountAtoms: string; utxoCount: number }[];
  tokenUtxos: { txid: string; vout: number; tokenId: string; amountAtoms: string }[];
  listings: { listingId: string; tokenId: string; amountAtoms: string; totalPriceSats: string; status: string }[];
  fills: { id: string; listingId: string; tokenId: string; status: string; amountAtoms: string; totalPriceSats: string; marketFeeSats: string; minerFeeSats: string; unsignedTxDigest: string | null; psbtBase64: string | null; txid: string | null }[];
}

function WalletContent() {
  const searchParams = useSearchParams();
  // Client-side design-preview path: no API calls, no writes.
  const demo = searchParams.get("demo") === "1";
  const { connected, address, ordinalsAddress, script, ordinalsScript, network, walletFields, connect, signPsbt, signBip322, getUtxos } = useWallet();
  const { satPerVb } = useFeeRates();
  // Which holding has its Send form open, and what is typed into it.
  const [sending, setSending] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Refetch when a new block is indexed: holdings change only then.
  const height = useIndexedHeight();

  useEffect(() => {
    if (demo) {
      setPortfolio(DEMO_PORTFOLIO as unknown as Portfolio);
      setLoaded(true);
      return;
    }
    if (!connected || !address) return;
    void refresh();
  }, [connected, address, demo, height]);

  async function refresh() {
    if (!address) return;
    if (demo) {
      setPortfolio(DEMO_PORTFOLIO as unknown as Portfolio);
      setLoaded(true);
      return;
    }
    // Holdings sit on the ordinals address; a wallet with one address for
    // everything falls back to it.
    const r = await fetch(`/api/v3/wallet/${ordinalsAddress || address}/portfolio`).then((r) => r.json());
    if (r.ok) setPortfolio(r.data);
    setLoaded(true);
  }

  async function sellerSign(fill: { id: string; listingId: string; tokenId: string; status: string; amountAtoms: string; totalPriceSats: string; marketFeeSats: string; minerFeeSats: string; unsignedTxDigest: string | null; psbtBase64: string | null; txid: string | null }) {
    setErr("");
    if (!fill.psbtBase64) return;
    setBusy(fill.id);
    try {
      // §M3: re-derive the seller's P2P payout (full price to the seller's own
      // script) from the fill before signing — never blind-sign the server PSBT.
      if (fill.unsignedTxDigest) {
        verifyClientIntent(fill.psbtBase64, {
          operation: "P2P_SELL",
          tokenId: fill.tokenId,
          tokenAmountAtoms: fill.amountAtoms,
          grossSats: null,
          protocolFeeSats: fill.marketFeeSats,
          minerFeeSats: fill.minerFeeSats,
          netSats: fill.totalPriceSats,
          walletScript: script,
          // Token change from a partial sale returns to the ordinals address.
          ordinalsScript: ordinalsScript || script,
          stateHash: null,
          unsignedTxDigest: fill.unsignedTxDigest,
        });
      }
      const signed = await signPsbt(fill.psbtBase64, "P2P_SELL");
      const sr = await fetch(`/api/v3/market/fills/${fill.id}/seller-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedPsbtBase64: signed }),
      });
      const sj = await sr.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "seller signature failed");
      const fr = await fetch(`/api/v3/market/fills/${fill.id}/finalize`, { method: "POST" });
      const fj = await fr.json();
      if (!fj.ok) throw new Error(fj.error?.message ?? "finalize failed");
      setMsg(`Sale broadcast ${fj.data.txid.slice(0, 16)}…`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function send(tokenId: string) {
    setErr("");
    setMsg("");
    setBusy(`send-${tokenId}`);
    try {
      const txid = await sendTokens({
        tokenId,
        amountAtoms: displayTokensToAtoms(sendAmount),
        recipient: sendTo,
        network,
        walletFields: walletFields(),
        getUtxos,
        signPsbt,
        satPerVb,
      });
      setMsg(`Sent. It arrives when the next block confirms it (${txid.slice(0, 16)}…).`);
      setSending(null);
      setSendAmount("");
      setSendTo("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(listingId: string) {
    setErr("");
    setBusy(listingId);
    try {
      const pr = await fetch(`/api/v3/market/listings/${listingId}/cancel/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const pj = await pr.json();
      if (!pj.ok) throw new Error(pj.error?.message ?? "cancel prepare failed");
      const sig = await signBip322(pj.data.message);
      const cr = await fetch(`/api/v3/market/listings/${listingId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonceHex: pj.data.cancelNonce, signatureB64: sig }),
      });
      const cj = await cr.json();
      if (!cj.ok) throw new Error(cj.error?.message ?? "cancel failed");
      setMsg("Listing cancelled");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!connected && !demo) {
    return (
      <div className="border border-dashed border-rule bg-ink-3 px-6 py-12 text-center">
        <p className="text-bone-dim">Connect a wallet to view holdings.</p>
        <button onClick={() => void connect()} className="mt-4 bg-signal px-6 py-3 text-bone hover:bg-[#F0A253]">Connect Wallet</button>
      </div>
    );
  }

  if (!loaded || !portfolio) return <div className="text-bone-dim">Loading wallet…</div>;

  const salesRequired = portfolio.fills.filter((f) => f.status === "BUYER_SIGNED");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl text-bone">Wallet</h1>
        <p className="break-all font-mono text-xs text-bone-dim">{address}</p>
      </div>

      {salesRequired.length > 0 && (
        <section className="border border-warning/40 bg-ink-2 p-5">
          <h2 className="text-bone">Sales requiring signature</h2>
          {salesRequired.map((f) => (
            <div key={f.id} className="mt-3 flex items-center justify-between border-b border-border/40 py-2 last:border-0">
              <div className="text-sm">
                <div className="text-bone">{fmtTokens(BigInt(f.amountAtoms))} for {fmtBtc(BigInt(f.totalPriceSats))}</div>
                <div className="font-mono text-xs text-bone-dim">fill {f.id.slice(0, 8)}</div>
              </div>
              <button onClick={() => void sellerSign(f)} disabled={busy === f.id} className="bg-signal px-4 py-2 text-sm text-bone hover:bg-[#F0A253] disabled:opacity-50">
                {busy === f.id ? "Signing…" : "Review & Sign Sale"}
              </button>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-lg text-bone">Holdings</h2>
        {portfolio.holdings.length === 0 ? (
          <p className="mt-2 text-sm text-bone-dim">No token holdings yet.</p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {portfolio.holdings.map((h) => (
              <div key={h.tokenId} className="border border-rule bg-ink-2 p-4">
                <a href={`/token/${h.tokenId}`} className="block">
                  <div className="font-mono text-xs text-bone-dim">{h.tokenId.slice(0, 16)}…</div>
                  <div className="mt-1 text-xl text-bone">{fmtTokens(BigInt(h.amountAtoms))}</div>
                  <div className="text-xs text-bone-dim">{h.utxoCount} token UTXO{h.utxoCount === 1 ? "" : "s"}</div>
                </a>
                {sending === h.tokenId ? (
                  <div className="mt-3 space-y-2">
                    <input
                      aria-label="Send amount"
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                      placeholder="How many tokens"
                      className="field"
                    />
                    <input
                      aria-label="Send to address"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value.trim())}
                      placeholder="Their token address (bc1p…)"
                      className="field"
                    />
                    <div className="grid grid-cols-2 gap-px bg-rule">
                      <button onClick={() => setSending(null)} className="btn-ghost w-full border-0">Cancel</button>
                      <button onClick={() => void send(h.tokenId)} disabled={busy !== null} className="btn w-full">
                        {busy === `send-${h.tokenId}` ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setSending(h.tokenId)} className="mt-3 border border-rule px-3 py-1.5 text-xs text-bone-2 hover:text-bone">
                    Send
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg text-bone">My listings</h2>
        {portfolio.listings.length === 0 ? (
          <p className="mt-2 text-sm text-bone-dim">No listings.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {portfolio.listings.map((l) => (
              <div key={l.listingId} className="flex items-center justify-between border border-rule bg-ink-2 p-3 text-sm">
                <div>
                  <div className="text-bone">{fmtTokens(BigInt(l.amountAtoms))} @ {fmtBtc(BigInt(l.totalPriceSats))}</div>
                  <div className="text-xs text-bone-dim">{l.status}</div>
                </div>
                {l.status === "ACTIVE" && (
                  <button onClick={() => void cancel(l.listingId)} disabled={busy === l.listingId} className="border border-rule px-3 py-1.5 text-xs text-bone-2 hover:border-danger hover:text-danger disabled:opacity-50">
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {msg && <p className="text-sm text-success">{msg}</p>}
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/**
 * useSearchParams opts this route into client-side rendering, which Next
 * requires to sit behind a Suspense boundary.
 */
export default function WalletPage() {
  return (
    <Suspense fallback={<div className="panel px-6 py-16 text-center text-sm text-bone-dim">Loading…</div>}>
      <WalletContent />
    </Suspense>
  );
}
