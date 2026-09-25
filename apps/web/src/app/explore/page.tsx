"use client";

import { useEffect, useState } from "react";
import { TokenCard, type V3TokenCardData } from "@/components/TokenCard";

export default function ExplorePage() {
  const [tokens, setTokens] = useState<V3TokenCardData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoaded(false);
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    void fetch(`/api/v3/tokens${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setTokens(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-bone">Explore</h1>
        <p className="text-sm text-bone-dim">Confirmed Cove tokens (tokenId, ticker or name search).</p>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tokenId, ticker or name"
        className="w-full max-w-md border border-rule bg-ink-2 px-4 py-2 text-sm text-bone outline-none focus:border-brand"
      />
      {!loaded ? (
        <Empty message="Loading…" />
      ) : tokens.length === 0 ? (
        <Empty message="No tokens found." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.map((t) => (
            <TokenCard key={t.tokenId} token={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="border border-dashed border-rule bg-ink-3 px-6 py-12 text-center text-bone-dim">{message}</div>;
}
