"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { fmtPricePerMillion, fmtSats, fmtTokens } from "@/lib/format";
import { verifyWalletTransaction } from "@/lib/verify-wallet-tx";

interface Listing {
  listingId: string;
  deploymentId: string;
  sellerAddress: string;
  tokenAmountAtoms: string;
  askingPriceSats: string;
  pricePerMillionSats: string;
  expiryHeight: string;
  status: string;
}

export function MarketSection({ deploymentId, ticker }: { deploymentId: string; ticker: string }) {
  const { address, signPsbt } = useWallet();
  const [listings, setListings] = useState<Listing[]>([]);
  const [sellAmount, setSellAmount] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/market/listings?deploymentId=${deploymentId}`);
    const j = await res.json();
    if (j.ok) setListings(j.data);
  }, [deploymentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const buildAndSign = async (
    buildUrl: string,
    buildBody: Record<string, unknown>,
    operation: "DEX_ASK" | "DEX_BID" | "DEX_CANCEL",
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const b = await fetch(buildUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody),
      });
      const bj = await b.json();
      if (!bj.ok) {
        setError(bj.error?.message ?? "Build failed.");
        return;
      }
      verifyWalletTransaction(bj.data.unsignedTx, address);
      const signed = await signPsbt(bj.data.unsignedTx.psbtBase64);
      const c = await fetch("/api/market/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedPsbt: signed, walletAddress: address, operation, deploymentId }),
      });
      const cj = await c.json();
      if (!cj.ok) setError(cj.error?.message ?? "Broadcast failed.");
      else {
        setNotice("Transaction broadcast. Indexing shortly…");
        setSellAmount("");
        setSellPrice("");
        void refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sell form */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="mb-3 font-semibold text-white">Sell {ticker}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Token amount (atoms)"
            className="rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
          />
          <input
            value={sellPrice}
            onChange={(e) => setSellPrice(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Total asking price (sats)"
            className="rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
          />
        </div>
        <button
          onClick={() =>
            void buildAndSign(
              "/api/market/sell/build",
              {
                deploymentId,
                sellerAddress: address,
                tokenAmountAtoms: sellAmount,
                askingPriceSats: sellPrice,
                expiryBlocks: 144,
              },
              "DEX_ASK",
            )
          }
          disabled={busy || !sellAmount || !sellPrice}
          className="mt-3 rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-bright disabled:opacity-40"
        >
          Create listing
        </button>
        <p className="mt-2 text-xs text-gray-500">Full-fill listings only. Default expiry: 144 blocks.</p>
      </div>

      {/* Listings */}
      <div>
        <h3 className="mb-3 font-semibold text-white">Open listings</h3>
        {listings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-gray-500">
            No trades yet.
          </p>
        ) : (
          <div className="space-y-3">
            {listings.map((l) => (
              <div key={l.listingId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
                <div>
                  <div className="font-semibold text-white">{fmtTokens(l.tokenAmountAtoms)} {ticker}</div>
                  <div className="text-sm text-gray-400">
                    {fmtSats(l.askingPriceSats)} total · {fmtPricePerMillion(l.pricePerMillionSats)}
                  </div>
                  <div className="text-xs text-gray-500">by {shortAddr(l.sellerAddress)}</div>
                </div>
                <div className="flex gap-2">
                  {l.sellerAddress === address ? (
                    <button
                      onClick={() =>
                        void buildAndSign(
                          "/api/market/cancel/build",
                          { listingId: l.listingId, sellerAddress: address },
                          "DEX_CANCEL",
                        )
                      }
                      disabled={busy}
                      className="rounded-lg border border-border px-4 py-2 text-sm text-gray-200 hover:border-danger"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        void buildAndSign(
                          "/api/market/buy/build",
                          { listingId: l.listingId, buyerAddress: address },
                          "DEX_BID",
                        )
                      }
                      disabled={busy}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-bright"
                    >
                      Buy
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {notice && <p className="text-sm text-success">{notice}</p>}
    </div>
  );
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
