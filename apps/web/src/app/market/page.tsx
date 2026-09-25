"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { fmtBtc, fmtTokens } from "@/lib/format";
import { verifyClientIntent } from "@crclaunch/wallets";

interface Listing {
  id: string;
  listingId: string;
  tokenId: string;
  amountAtoms: string;
  totalPriceSats: string;
  expiryHeight: string;
  status: string;
  sellerTokenScript: string;
}

export default function MarketPage() {
  const { connected, script, connect, signPsbt, signBip322, getUtxos } = useWallet();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    void fetch("/api/v3/market/listings")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setListings(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function buy(listing: Listing) {
    if (!connected) return;
    setErr("");
    setBuying(listing.listingId);
    setMsg("");
    try {
      const funding = await getUtxos();
      // §M4: require a signed nonce to reserve — prepare, sign, then reserve.
      const pr = await fetch(`/api/v3/market/listings/${listing.listingId}/reserve/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buyerTokenScript: script }),
      });
      const pj = await pr.json();
      if (!pj.ok) throw new Error(pj.error?.message ?? "reserve prepare failed");
      const signatureB64 = await signBip322(pj.data.message);
      const rr = await fetch(`/api/v3/market/listings/${listing.listingId}/reserve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buyerTokenScript: script, buyerChangeScript: script, funding, nonceHex: pj.data.reserveNonce, signatureB64 }),
      });
      const rj = await rr.json();
      if (!rj.ok) throw new Error(rj.error?.message ?? "reserve failed");
      const fillId = rj.data.fillId;

      const br = await fetch(`/api/v3/market/fills/${fillId}/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minerFeeSats: "1000" }),
      });
      const bj = await br.json();
      if (!bj.ok) throw new Error(bj.error?.message ?? "build failed");

      // §M3: independently re-derive the P2P outputs from the user's own input
      // before signing (the server-supplied digest alone is circular).
      if (bj.data.intent) verifyClientIntent(bj.data.psbtBase64, bj.data.intent);

      const signed = await signPsbt(bj.data.psbtBase64, "P2P_BUY");
      const sr = await fetch(`/api/v3/market/fills/${fillId}/buyer-signature`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedPsbtBase64: signed }),
      });
      const sj = await sr.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "buyer signature failed");
      setMsg(`Buyer signed — waiting for seller (fill ${fillId.slice(0, 8)})…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">P2P Market</h1>
        <p className="text-sm text-gray-400">Active fixed-price asks. No fake bids, no synthetic liquidity.</p>
      </div>
      {!loaded ? (
        <Empty message="Loading listings…" />
      ) : listings.length === 0 ? (
        <Empty message="No active listings yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <div key={l.listingId} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs text-gray-400">{l.tokenId.slice(0, 12)}…</div>
                <span className="text-xs text-gray-500">{l.status}</span>
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Lot</span><span className="text-gray-200">{fmtTokens(BigInt(l.amountAtoms))}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Seller price</span><span className="text-gray-200">{fmtBtc(BigInt(l.totalPriceSats))}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Seller</span><span className="text-gray-400 font-mono text-xs">{l.sellerTokenScript.slice(0, 12)}…</span></div>
              </div>
              <button
                onClick={() => void buy(l)}
                disabled={!connected || buying === l.listingId}
                className="mt-3 w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-bright disabled:opacity-50"
              >
                {buying === l.listingId ? "Reserving…" : "Buy"}
              </button>
            </div>
          ))}
        </div>
      )}
      {!connected && (
        <div className="text-center">
          <button onClick={() => void connect()} className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-bright">
            Connect wallet
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-success">{msg}</p>}
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center text-gray-400">{message}</div>;
}
