"use client";

import { useState } from "react";
import Link from "next/link";

const STEPS = [
  { n: "01", title: "Launch", body: "Create a CRC-20 token. You choose only name, ticker and metadata." },
  { n: "02", title: "Deploy", body: "The deployment is broadcast to the (simulated) chain and indexed." },
  { n: "03", title: "Progressive mint", body: "Every mint raises the price across 20 fixed stages." },
  { n: "04", title: "Sell out", body: "84% of supply mints out; the final mint closes the curve." },
  { n: "05", title: "Graduate", body: "SOLD OUT → GRADUATING → GRADUATED after finality." },
  { n: "06", title: "Marketplace", body: "Holders list non-custodial fixed-price listings; others take them." },
];

export default function DemoPage() {
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = async () => {
    setResetting(true);
    setDone(false);
    try {
      await fetch("/api/demo/reset", { method: "POST" });
      setDone(true);
      setTimeout(() => window.location.reload(), 1200);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Demo Network
            </span>
            <span className="text-xs text-gray-500">Simulated — not real Bitcoin</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold text-white">The full lifecycle in two minutes</h1>
          <p className="mt-2 max-w-xl text-gray-400">
            Everything below runs on a simulated chain with a mock wallet. No funds, no keys, no
            mainnet.
          </p>
        </div>
        <button
          onClick={() => void reset()}
          disabled={resetting}
          className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium text-gray-200 hover:border-brand"
        >
          {resetting ? "Resetting…" : "Reset Demo"}
        </button>
      </div>

      {done && <p className="text-sm text-success">Demo reset. Reloading…</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-border bg-surface p-5">
            <div className="text-xs font-bold text-brand">{s.n}</div>
            <div className="mt-1 text-lg font-semibold text-white">{s.title}</div>
            <p className="mt-2 text-sm text-gray-400">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/launch"
          className="rounded-2xl border border-brand/40 bg-brand/10 p-6 transition hover:bg-brand/15"
        >
          <div className="text-lg font-semibold text-white">Launch a token →</div>
          <p className="mt-1 text-sm text-gray-400">Run the full creator flow end-to-end.</p>
        </Link>
        <Link
          href="/token/seed-frog-00000000000000000000000000000000"
          className="rounded-2xl border border-border bg-surface p-6 transition hover:border-brand/60"
        >
          <div className="text-lg font-semibold text-white">Mint FROG →</div>
          <p className="mt-1 text-sm text-gray-400">A pre-seeded live token at 63% minted.</p>
        </Link>
      </div>

      <p className="text-xs text-gray-500">
        To reproduce from scratch: <code className="text-gray-400">pnpm demo:reset</code> then open
        this page.
      </p>
    </div>
  );
}
