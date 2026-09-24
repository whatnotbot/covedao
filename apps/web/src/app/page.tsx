"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TokenCard, type V3TokenCardData } from "@/components/TokenCard";

export default function HomePage() {
  const [tokens, setTokens] = useState<V3TokenCardData[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/v3/tokens?limit=9")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setTokens(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <div className="space-y-12">
      <section className="rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-brand/10 px-6 py-14 text-center sm:px-10">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Bitcoin-native tokens.</h1>
        <p className="mx-auto mt-4 max-w-xl text-gray-300">
          Launch Bitcoin-native tokens with deterministic backing. Buy from Cove Backing, redeem back to
          BTC, transfer directly, or trade fixed-price P2P.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/launch" className="rounded-xl bg-brand px-6 py-3 font-semibold text-white transition hover:bg-brand-bright">
            Launch Token
          </Link>
          <Link href="/explore" className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-gray-200 transition hover:border-brand/60">
            Explore
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Recent launches</h2>
          <Link href="/explore" className="text-sm text-gray-400 hover:text-white">View all</Link>
        </div>
        {!loaded ? (
          <Empty message="Loading tokens…" />
        ) : tokens.length === 0 ? (
          <Empty message="No confirmed tokens yet. Be the first to launch one." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t) => (
              <TokenCard key={t.tokenId} token={t} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">How Cove works</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <Explain title="Buy from Backing" body="Deposit BTC into the deterministic Cove Backing reserve and receive freshly issued tokens." />
          <Explain title="Redeem to Backing" body="Instant-sell tokens back to the reserve for the deterministic R-delta, minus a protocol fee." />
          <Explain title="Trade P2P" body="List a real token UTXO for a fixed BTC price and settle atomically in one Bitcoin transaction." />
        </div>
        <div className="mt-6 text-sm text-gray-400">
          <p>Bitcoin enforces UTXO spending, signatures, value conservation and double-spend prevention.</p>
          <p>Cove clients/indexer validate token ownership lineage and supply/backing state; the Guardian pre-executes Simplicity and the reference policy for backing transitions.</p>
        </div>
      </section>
    </div>
  );
}

function Explain({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-medium text-white">{title}</div>
      <p className="mt-1 text-sm text-gray-400">{body}</p>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center text-gray-400">
      {message}
    </div>
  );
}
