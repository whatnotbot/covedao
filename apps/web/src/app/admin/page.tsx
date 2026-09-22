"use client";

import { useEffect, useState } from "react";

interface AdminStatus {
  network: string;
  protocolVerified: boolean;
  protocol: { state: string; synced: boolean; stateValid: boolean; lagBlocks: string };
  bitcoinHeight: string;
  protocolHeight: string;
  counts: { tokens: number; events: number; listings: number; trades: number };
}

export default function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/status")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setStatus(j.data);
        else setError(j.error?.message ?? "Admin access required.");
      })
      .catch(() => setError("Failed to load."));
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!status) return <p className="text-gray-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Admin dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card label="Network" value={status.network} />
        <Card label="Protocol verified" value={status.protocolVerified ? "yes" : "no"} />
        <Card label="Protocol state" value={status.protocol.state} />
        <Card label="Protocol synced" value={status.protocol.synced ? "yes" : "no"} />
        <Card label="Bitcoin height" value={status.bitcoinHeight} />
        <Card label="Protocol height" value={status.protocolHeight} />
        <Card label="Indexer lag" value={`${status.protocol.lagBlocks} blocks`} />
        <Card label="Tokens" value={String(status.counts.tokens)} />
        <Card label="Events" value={String(status.counts.events)} />
        <Card label="Listings" value={String(status.counts.listings)} />
        <Card label="Trades" value={String(status.counts.trades)} />
      </div>
      <p className="text-sm text-gray-500">
        Admin cannot change balances, mint tokens, steal reserve, modify confirmed supply, or rewrite
        chain events. All admin actions are recorded.
      </p>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono-nums text-white">{value}</div>
    </div>
  );
}
