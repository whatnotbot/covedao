"use client";

import { useEffect, useState } from "react";
import { fmtSats, fmtTokens } from "@/lib/format";

interface Event {
  txid: string;
  blockHeight: string;
  eventType: string;
  walletFrom: string | null;
  walletTo: string | null;
  tokenAmountAtoms: string | null;
  btcAmountSats: string | null;
}

export function ActivityFeed({ deploymentId }: { deploymentId: string }) {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    void fetch(`/api/tokens/${deploymentId}/activity`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setEvents(j.data);
      })
      .catch(() => {});
  }, [deploymentId]);

  if (events.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-gray-500">No activity yet.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={`${e.txid}:${e.eventType}`} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{e.eventType}</span>
            <span className="text-gray-300">
              {e.tokenAmountAtoms ? fmtTokens(e.tokenAmountAtoms) : ""}
              {e.btcAmountSats ? ` · ${fmtSats(e.btcAmountSats)}` : ""}
            </span>
          </div>
          <span className="text-xs text-gray-500">block {e.blockHeight}</span>
        </div>
      ))}
    </div>
  );
}
