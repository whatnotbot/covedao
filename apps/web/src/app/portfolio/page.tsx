"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { fmtBtc, fmtSats, fmtTokens } from "@/lib/format";

interface Portfolio {
  address: string;
  btcSats: string;
  balances: { deploymentId: string; balanceAtoms: string; pendingAtoms: string; lockedAtoms: string }[];
  mints: { txid: string | null; deploymentId: string; tokenAmountAtoms: string; curveContributionSats: string; status: string }[];
  trades: { txid: string; deploymentId: string; tokenAmountAtoms: string; priceSats: string; side: string }[];
  listings: { listingId: string; deploymentId: string; tokenAmountAtoms: string; askingPriceSats: string; status: string }[];
}

export default function PortfolioPage() {
  const { address } = useWallet();
  const [data, setData] = useState<Portfolio | null>(null);

  useEffect(() => {
    if (!address) return;
    void fetch(`/api/wallet/${address}/portfolio`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j.data);
      })
      .catch(() => {});
  }, [address]);

  if (!data) return <p className="text-gray-400">Loading portfolio…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <p className="mt-1 text-sm text-gray-400">{data.address}</p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="text-xs text-gray-500">BTC balance</div>
        <div className="mt-1 font-mono-nums text-2xl font-semibold text-white">{fmtBtc(data.btcSats)}</div>
      </div>

      <section>
        <h2 className="mb-3 font-semibold text-white">Token balances</h2>
        {data.balances.length === 0 ? (
          <p className="text-gray-500">No tokens yet.</p>
        ) : (
          <div className="space-y-2">
            {data.balances.map((b) => (
              <Link
                key={b.deploymentId}
                href={`/token/${b.deploymentId}`}
                className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="text-gray-300">{shortAddr(b.deploymentId)}</span>
                <span className="font-mono-nums text-white">{fmtTokens(b.balanceAtoms)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-white">Mint history</h2>
        {data.mints.length === 0 ? (
          <p className="text-gray-500">No mints yet.</p>
        ) : (
          <div className="space-y-2">
            {data.mints.map((m, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <span className="text-gray-300">{fmtTokens(m.tokenAmountAtoms)}</span>
                <span className="text-gray-400">{fmtSats(m.curveContributionSats)}</span>
                <span className="text-xs text-gray-500">{m.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-white">Trades</h2>
        {data.trades.length === 0 ? (
          <p className="text-gray-500">No trades yet.</p>
        ) : (
          <div className="space-y-2">
            {data.trades.map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <span className={t.side === "BUY" ? "text-success" : "text-danger"}>{t.side}</span>
                <span className="text-gray-300">{fmtTokens(t.tokenAmountAtoms)}</span>
                <span className="text-gray-400">{fmtSats(t.priceSats)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-white">Listings</h2>
        {data.listings.length === 0 ? (
          <p className="text-gray-500">No listings.</p>
        ) : (
          <div className="space-y-2">
            {data.listings.map((l, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <span className="text-gray-300">{fmtTokens(l.tokenAmountAtoms)}</span>
                <span className="text-gray-400">{fmtSats(l.askingPriceSats)}</span>
                <span className="text-xs text-gray-500">{l.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
