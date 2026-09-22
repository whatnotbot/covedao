"use client";

import { useEffect, useState } from "react";

interface Status {
  bitcoin: { height: string; synced: boolean };
  protocol: { height: string; state: string; synced: boolean; lagBlocks: string };
  writeMode: string;
  network: string;
  protocolVerified: boolean;
}

export function StatusBar() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetch("/api/protocol/status")
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

  const synced = status.protocol.synced;

  return (
    <footer className="sticky bottom-0 z-40 border-t border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs text-gray-400 sm:px-6">
        <span className="flex items-center gap-1.5">
          <Dot color={synced ? "bg-success" : "bg-danger"} /> Bitcoin · synced
        </span>
        <span className="flex items-center gap-1.5">
          <Dot color={synced ? "bg-success" : "bg-danger"} /> CRC indexer · {synced ? "synced" : "lagging"}
        </span>
        <span className="flex items-center gap-1.5">
          <Dot color={synced ? "bg-success" : "bg-danger"} /> PRECOP · {synced ? "synced" : "unavailable"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          Write mode{" "}
          <span className={status.writeMode === "enabled" ? "text-success" : "text-gray-500"}>
            {status.writeMode === "enabled" ? "● enabled" : "○ disabled"}
          </span>
        </span>
      </div>
    </footer>
  );
}

function Dot({ color }: { color: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}
