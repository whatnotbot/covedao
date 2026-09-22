"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";

const TOKENOMICS = [
  ["Supply", "1,000,000,000"],
  ["Public mint", "840,000,000 (84%)"],
  ["Graduation reserve", "160,000,000 (16%)"],
  ["Stages", "20"],
  ["Starting price", "500 sats / 1M"],
  ["Final mint price", "149,731 sats / 1M"],
  ["Creator premine", "0"],
  ["Primary platform fee", "1%"],
  ["Launch fee", "10,000 sats"],
] as const;

export default function LaunchPage() {
  const { address, signPsbt } = useWallet();
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  const canDeploy = name.trim() && /^[A-Z0-9]{4}$/.test(ticker) && risk && !busy;

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await fetch("/api/launch/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, ticker, description }),
      });
      const vj = await v.json();
      if (!vj.ok) {
        setError(vj.error?.message ?? "Validation failed.");
        setBusy(false);
        return;
      }

      const b = await fetch("/api/launch/build", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${address}:${ticker}:${Date.now()}` },
        body: JSON.stringify({
          name,
          ticker,
          description,
          websiteUrl: website || "",
          walletAddress: address,
          termsVersion: "1.0",
        }),
      });
      const bj = await b.json();
      if (!bj.ok) {
        setError(bj.error?.message ?? "Build failed.");
        setBusy(false);
        return;
      }

      const signed = await signPsbt(bj.data.unsignedTx.psbtBase64);
      const c = await fetch("/api/launch/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedPsbt: signed,
          walletAddress: address,
          operation: "DEPLOY",
          deploymentId: bj.data.deploymentId,
        }),
      });
      const cj = await c.json();
      if (!cj.ok) setError(cj.error?.message ?? "Broadcast failed.");
      else setTxid(cj.data.txid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setBusy(false);
    }
  };

  if (txid) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-border bg-surface p-8 text-center">
        <div className="text-4xl">🚀</div>
        <h1 className="mt-3 text-xl font-bold text-white">Token deployed</h1>
        <p className="mt-1 text-sm text-gray-400">Transaction submitted. Indexing…</p>
        <p className="mt-2 break-all rounded-xl bg-bg p-3 text-xs text-gray-300">{txid}</p>
        <Link href={`/token/${txid}`} className="mt-4 inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-white">
          View token
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Launch a token</h1>
        <p className="mt-1 text-sm text-gray-400">
          Standardized tokenomics. You choose only the name, ticker and metadata.
        </p>
      </div>

      {/* Step 1: metadata */}
      <section className="space-y-4 rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-semibold text-white">1. Token details</h2>
        <Field label="Name" value={name} onChange={setName} placeholder="Frog Token" />
        <Field
          label="Ticker (exactly 4 uppercase A-Z / 0-9)"
          value={ticker}
          onChange={(v) => setTicker(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
          placeholder="FROG"
        />
        <Field label="Description (plain text)" value={description} onChange={setDescription} placeholder="Optional description" />
        <Field label="Website (optional, https)" value={website} onChange={setWebsite} placeholder="https://…" />
      </section>

      {/* Step 2: your launch */}
      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-semibold text-white">2. Your launch</h2>
        <p className="mb-4 text-sm text-gray-400">Standardized and immutable. You can&apos;t edit these.</p>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Supply" value="1,000,000,000" />
          <Stat label="Public mint" value="84%" />
          <Stat label="Stages" value="20" />
          <Stat label="Creator premine" value="0" />
          <Stat label="Starts" value="500 sats / 1M" />
          <Stat label="Ends" value="149,731 sats / 1M" />
        </div>

        <details className="mt-4 rounded-xl border border-border bg-bg p-4">
          <summary className="cursor-pointer text-sm text-gray-400">Advanced Details</summary>
          <div className="mt-3 space-y-1.5 text-sm">
            {TOKENOMICS.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-gray-400">{k}</span>
                <span className="font-mono-nums text-gray-200">{v}</span>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* Step 3: risk */}
      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="mb-3 font-semibold text-white">3. Risk confirmation</h2>
        <div className="flex items-start gap-3 text-sm text-gray-300">
          <input
            id="risk-confirm"
            type="checkbox"
            checked={risk}
            onChange={(e) => setRisk(e.target.checked)}
            className="mt-1"
          />
          <label htmlFor="risk-confirm" className="cursor-pointer">
            I understand CRC/PRECOP is experimental and token launches may lose value or fail due to
            protocol, Bitcoin, wallet or software behavior.
          </label>
        </div>
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        onClick={() => void deploy()}
        disabled={!canDeploy}
        className="relative z-10 w-full scroll-mb-24 rounded-xl bg-brand px-6 py-4 text-lg font-semibold text-white transition hover:bg-brand-bright disabled:opacity-40"
      >
        {busy ? "Deploying…" : "Deploy token"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono-nums text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
      />
    </div>
  );
}
