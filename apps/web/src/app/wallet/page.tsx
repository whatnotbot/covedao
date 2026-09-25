"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { fmtBtc, fmtTokens } from "@/lib/format";
import { verifyClientIntent } from "@crclaunch/wallets";

interface Portfolio {
  holdings: { tokenId: string; amountAtoms: string; utxoCount: number }[];
  tokenUtxos: { txid: string; vout: number; tokenId: string; amountAtoms: string }[];
  listings: { listingId: string; tokenId: string; amountAtoms: string; totalPriceSats: string; status: string }[];
  fills: { id: string; listingId: string; tokenId: string; status: string; amountAtoms: string; totalPriceSats: string; marketFeeSats: string; minerFeeSats: string; unsignedTxDigest: string | null; psbtBase64: string | null; txid: string | null }[];
}

export default function WalletPage() {
  const { connected, address, script, connect, signPsbt, signBip322 } = useWallet();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !address) return;
    void refresh();
  }, [connected, address]);

  async function refresh() {
    if (!address) return;
    const r = await fetch(`/api/v3/wallet/${address}/portfolio`).then((r) => r.json());
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

  if (!connected) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center">
        <p className="text-gray-400">Connect a wallet to view holdings.</p>
        <button onClick={() => void connect()} className="mt-4 rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-bright">Connect Wallet</button>
      </div>
    );
  }

  if (!loaded || !portfolio) return <div className="text-gray-400">Loading wallet…</div>;

  const salesRequired = portfolio.fills.filter((f) => f.status === "BUYER_SIGNED");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Wallet</h1>
        <p className="break-all font-mono text-xs text-gray-500">{address}</p>
      </div>

      {salesRequired.length > 0 && (
        <section className="rounded-2xl border border-warning/40 bg-surface p-5">
          <h2 className="font-semibold text-white">Sales requiring signature</h2>
          {salesRequired.map((f) => (
            <div key={f.id} className="mt-3 flex items-center justify-between border-b border-border/40 py-2 last:border-0">
              <div className="text-sm">
                <div className="text-gray-200">{fmtTokens(BigInt(f.amountAtoms))} for {fmtBtc(BigInt(f.totalPriceSats))}</div>
                <div className="font-mono text-xs text-gray-500">fill {f.id.slice(0, 8)}</div>
              </div>
              <button onClick={() => void sellerSign(f)} disabled={busy === f.id} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-bright disabled:opacity-50">
                {busy === f.id ? "Signing…" : "Review & Sign Sale"}
              </button>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-white">Holdings</h2>
        {portfolio.holdings.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">No token holdings yet.</p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {portfolio.holdings.map((h) => (
              <a key={h.tokenId} href={`/token/${h.tokenId}`} className="rounded-2xl border border-border bg-surface p-4">
                <div className="font-mono text-xs text-gray-400">{h.tokenId.slice(0, 16)}…</div>
                <div className="mt-1 text-xl font-semibold text-white">{fmtTokens(BigInt(h.amountAtoms))}</div>
                <div className="text-xs text-gray-500">{h.utxoCount} token UTXO{h.utxoCount === 1 ? "" : "s"}</div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">My listings</h2>
        {portfolio.listings.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">No listings.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {portfolio.listings.map((l) => (
              <div key={l.listingId} className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 text-sm">
                <div>
                  <div className="text-gray-200">{fmtTokens(BigInt(l.amountAtoms))} @ {fmtBtc(BigInt(l.totalPriceSats))}</div>
                  <div className="text-xs text-gray-500">{l.status}</div>
                </div>
                {l.status === "ACTIVE" && (
                  <button onClick={() => void cancel(l.listingId)} disabled={busy === l.listingId} className="rounded-lg border border-border px-3 py-1.5 text-xs text-gray-300 hover:border-danger hover:text-danger disabled:opacity-50">
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
