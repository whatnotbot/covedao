"use client";

import { useEffect, useState } from "react";

interface Event {
  txid: string;
  blockHeight: string;
  operation: string;
  tokenId: string | null;
  valid: boolean;
}

export default function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/v3/activity")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setEvents(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const label = (op: string | null) =>
    op === "DEPLOY" ? "Launch" : op === "MINT" ? "Backing buy" : op === "REDEEM" ? "Backing redeem" : op === "TRANSFER" ? "Transfer" : op ?? "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity</h1>
        <p className="text-sm text-gray-400">Canonical confirmed Cove events (never broadcast-as-confirmed).</p>
      </div>
      {!loaded ? (
        <p className="text-gray-400">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-gray-400">No confirmed events yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.txid} className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 text-sm">
              <div>
                <span className="text-gray-200">{label(e.operation)}</span>
                {e.tokenId && <span className="ml-2 font-mono text-xs text-gray-500">{e.tokenId.slice(0, 12)}…</span>}
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">height {e.blockHeight}</div>
                <div className="font-mono text-xs text-gray-600">{e.txid.slice(0, 16)}…</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
