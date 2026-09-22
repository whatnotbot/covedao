"use client";

import { useEffect, useState } from "react";

export function ModeBanner() {
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/protocol/status")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setMode(j.data.mode);
      })
      .catch(() => {});
  }, []);

  if (mode === null || mode === "DEMO") return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
      {mode === "READ_ONLY_MAINNET"
        ? "Mainnet read-only — write operations require canonical CRC integration."
        : "Canonical CRC integration pending — mainnet write operations are disabled."}
    </div>
  );
}
