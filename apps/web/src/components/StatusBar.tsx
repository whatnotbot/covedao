"use client";

import { useEffect, useState } from "react";

interface Status {
  network: string;
  appEnabled: boolean;
  core: { reachable: boolean; height: string; tip: string };
  indexer: { health: string; indexedHeight: string; stateRoot: string; lag: string; rebuilding: boolean };
  guardian: { configured: boolean };
  market: { enabled: boolean };
}

export function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetch("/api/v3/status")
        .then((r) => r.json())
        .then((j) => {
          if (active && j.ok) setStatus(j.data);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  if (!status) return null;

  const healthy = status.indexer.health === "HEALTHY";
  const coreOk = status.core.reachable;

  return (
    <footer className="border-t border-border bg-bg/90 backdrop-blur" aria-live="polite">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs text-gray-400 sm:px-6">
        <span className="flex items-center gap-1.5">
          <Dot color={coreOk ? "bg-success" : "bg-danger"} /> Bitcoin Core · {coreOk ? `height ${status.core.height}` : "unavailable"}
        </span>
        <span className="flex items-center gap-1.5">
          <Dot color={healthy ? "bg-success" : "bg-danger"} /> Cove indexer · {status.indexer.health.toLowerCase()}
          {status.indexer.lag !== "0" ? ` (lag ${status.indexer.lag})` : ""}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <Dot color={status.guardian.configured ? "bg-success" : "bg-warning"} /> Guardian · {status.guardian.configured ? "available" : "not configured"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {status.market.enabled ? <Dot color="bg-success" /> : <Dot color="bg-gray-500" />} market {status.market.enabled ? "enabled" : "disabled"}
          <span className="text-gray-600">· {status.network}</span>
        </span>
      </div>
    </footer>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}
