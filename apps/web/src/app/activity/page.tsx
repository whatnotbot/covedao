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
        <h1 className="text-2xl text-bone">Activity</h1>
        <p className="text-sm text-bone-dim">Canonical confirmed Cove events (never broadcast-as-confirmed).</p>
      </div>
      {!loaded ? (
        <p className="text-bone-dim">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-bone-dim">No confirmed events yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div key={e.txid} className="flex items-center justify-between border border-rule bg-ink-2 p-3 text-sm">
              <div>
                <span className="text-bone">{label(e.operation)}</span>
                {e.tokenId && <span className="ml-2 font-mono text-xs text-bone-dim">{e.tokenId.slice(0, 12)}…</span>}
              </div>
              <div className="text-right">
                <div className="text-xs text-bone-dim">height {e.blockHeight}</div>
                <div className="font-mono text-xs text-bone-dim">{e.txid.slice(0, 16)}…</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
