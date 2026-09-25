"use client";

import { useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { verifyClientIntent } from "@crclaunch/wallets";

interface Prepared {
  tokenId: string;
  ticker: string;
  nonceHex: string;
  policyVersion: number;
  publicCapAtoms: string;
  publicSupplyAtoms: string;
  curve: string;
  vaultAnchorSats: string;
}

export default function LaunchPage() {
  const { connected, address, script, connect, signPsbt, getUtxos } = useWallet();
  const [name, setName] = useState("E2E Frog");
  const [ticker, setTicker] = useState("FROG");
  const [description, setDescription] = useState("A deterministic backing test token.");
  const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [error, setError] = useState("");

  async function prepare() {
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/v3/launch/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker, displayName: name, description, websiteUrl: website, xUrl }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? "prepare failed");
      setPrepared(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function buildAndSign() {
    if (!prepared || !connected) return;
    setError("");
    setBusy(true);
    setStatus("Building…");
    try {
      const funding = await getUtxos();
      const build = await fetch("/api/v3/launch/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network: "regtest",
          ticker: prepared.ticker,
          nonceHex: prepared.nonceHex,
          walletScript: script,
          walletAddress: address,
          funding,
          minerFeeSats: "1000",
          displayName: name,
          description,
          websiteUrl: website,
          xUrl,
          idempotencyKey: `launch-${prepared.tokenId}`,
        }),
      });
      const bj = await build.json();
      if (!bj.ok) throw new Error(bj.error?.message ?? "build failed");
      // Client-side intent verification before opening the wallet.
      verifyClientIntent(bj.data.psbtBase64, bj.data.intent);
      setStatus("Signing…");
      const signed = await signPsbt(bj.data.psbtBase64, "DEPLOY");
      const submit = await fetch("/api/v3/launch/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: bj.data.sessionId, signedPsbtBase64: signed }),
      });
      const sj = await submit.json();
      if (!sj.ok) throw new Error(sj.error?.message ?? "submit failed");
      setTokenId(prepared.tokenId);
      setStatus(`Broadcast ${sj.data.txid.slice(0, 16)}…`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl text-bone">Launch a token</h1>
        <p className="text-sm text-bone-dim">Precomputable tokenId, deterministic geometric20 backing, policy V3.</p>
      </div>

      <div className="space-y-3">
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Ticker (1–16 uppercase alphanumeric)" value={ticker} onChange={(v) => setTicker(v.toUpperCase())} />
        <Field label="Description" value={description} onChange={setDescription} />
        <Field label="Website (https)" value={website} onChange={setWebsite} />
        <Field label="X (https)" value={xUrl} onChange={setXUrl} />
      </div>

      {!prepared ? (
        <button onClick={prepare} disabled={busy} className="w-full bg-signal px-6 py-3 text-bone hover:bg-[#F0A253] disabled:opacity-50">
          {busy ? "Preparing…" : "Review launch identity"}
        </button>
      ) : (
        <div className="border border-rule bg-ink-2 p-5 text-sm">
          <h2 className="text-bone">Review</h2>
          <Row k="tokenId" v={<span className="break-all font-mono text-xs">{prepared.tokenId}</span>} />
          <Row k="Ticker" v={`$${prepared.ticker}`} />
          <Row k="Policy" v={`V${prepared.policyVersion}`} />
          <Row k="Total supply" v="840,000,000 tokens" />
          <Row k="Creator allocation" v="0 tokens" />
          <Row k="Backing curve" v={prepared.curve} />
          <Row k="Vault anchor" v={`${prepared.vaultAnchorSats} sats`} />
          <div className="mt-4">
            {!connected ? (
              <button onClick={() => void connect()} className="w-full bg-signal px-6 py-3 text-bone hover:bg-[#F0A253]">
                Connect wallet to build
              </button>
            ) : (
              <button onClick={buildAndSign} disabled={busy} className="w-full bg-signal px-6 py-3 text-bone hover:bg-[#F0A253] disabled:opacity-50">
                {busy ? status || "Working…" : "Build, review and sign"}
              </button>
            )}
          </div>
        </div>
      )}

      {status && <p className="text-sm text-success">{status}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {tokenId && (
        <a href={`/token/${tokenId}`} className="block text-center text-sm text-signal hover:underline">
          Open token page →
        </a>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-bone-dim">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full border border-rule bg-ink-2 px-4 py-2 text-sm text-bone outline-none focus:border-brand" />
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-bone-dim">{k}</span>
      <span className="text-right text-bone">{v}</span>
    </div>
  );
}
