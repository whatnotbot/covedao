"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { fmtSats, fmtTokens } from "@/lib/format";
import { verifyWalletTransaction } from "@/lib/verify-wallet-tx";
import type { UnsignedProtocolTransaction } from "@crclaunch/protocol";

interface Quote {
  quoteId: string;
  tokens: string;
  curveContributionSats: string;
  platformFeeSats: string;
  estimatedMinerFeeSats: string;
  totalEstimatedSpendSats: string;
  startingStage: number;
  endingStage: number;
  stateHash: string;
  expiresAt: string;
  feeWarning: boolean;
  feeConfirmationRequired: boolean;
  feeBlocked: boolean;
}

export function MintButton({
  deploymentId,
  ticker,
  status,
}: {
  deploymentId: string;
  ticker: string;
  status: string;
}) {
  const { address, signPsbt } = useWallet();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"EXACT_TOKENS" | "EXACT_SATS">("EXACT_TOKENS");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [unsigned, setUnsigned] = useState<UnsignedProtocolTransaction | null>(null);
  const [step, setStep] = useState<"quote" | "review" | "done">("quote");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canMint = status === "LIVE";

  const fetchQuote = useCallback(
    async (value: string) => {
      if (!value || value === "0") {
        setQuote(null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/mint/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deploymentId,
            mode,
            walletAddress: address,
            ...(mode === "EXACT_TOKENS" ? { tokens: value } : { sats: value }),
          }),
        });
        const j = await res.json();
        if (!j.ok) setError(j.error?.message ?? "Quote failed.");
        else setQuote(j.data);
      } catch {
        setError("Network error.");
      } finally {
        setBusy(false);
      }
    },
    [deploymentId, mode, address],
  );

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetchQuote(amount), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [amount, open, fetchQuote]);

  const build = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mint/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, walletAddress: address }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "Build failed.");
        // Price may have moved — refresh quote.
        setQuote(null);
        void fetchQuote(amount);
      } else {
        setUnsigned(j.data.unsignedTx);
        setStep("review");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const signAndBroadcast = async () => {
    if (!unsigned) return;
    setBusy(true);
    setError(null);
    try {
      verifyWalletTransaction(unsigned, address);
      const signed = await signPsbt(unsigned.psbtBase64!);
      const res = await fetch("/api/mint/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedPsbt: signed, walletAddress: address, operation: "MINT", deploymentId }),
      });
      const j = await res.json();
      if (!j.ok) setError(j.error?.message ?? "Broadcast failed.");
      else {
        setTxid(j.data.txid);
        setStep("done");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!canMint}
        className="w-full rounded-xl bg-brand px-6 py-3 font-semibold text-white transition hover:bg-brand-bright disabled:cursor-not-allowed disabled:opacity-40"
      >
        {canMint ? `MINT ${ticker}` : "MINT CLOSED"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Mint {ticker}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white" aria-label="Close">
                ✕
              </button>
            </div>

            {step === "done" && txid ? (
              <div className="space-y-3 text-center">
                <div className="text-4xl">✅</div>
                <p className="text-white">Transaction submitted</p>
                <p className="break-all text-xs text-gray-400">{txid}</p>
                <p className="text-sm text-gray-400">
                  {fmtTokens(quote?.tokens ?? "0")} {ticker} pending — indexed on confirmation.
                </p>
                <button onClick={() => setOpen(false)} className="mt-2 w-full rounded-xl border border-border py-2 text-gray-200">
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Mode toggle */}
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
                  {(["EXACT_TOKENS", "EXACT_SATS"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setQuote(null);
                      }}
                      className={`rounded-lg py-2 text-sm ${mode === m ? "bg-brand text-white" : "text-gray-400"}`}
                    >
                      {m === "EXACT_TOKENS" ? "By tokens" : "By sats"}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-xs text-gray-400">
                    {mode === "EXACT_TOKENS" ? "Tokens to receive" : "Sats to spend"}
                  </label>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    placeholder={mode === "EXACT_TOKENS" ? "e.g. 2000000" : "e.g. 1000"}
                    className="mt-1 w-full rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
                  />
                </div>

                {busy && <div className="text-sm text-gray-400">Calculating…</div>}

                {quote && step === "quote" && (
                  <div className="space-y-2 rounded-xl border border-border bg-bg p-4 text-sm">
                    <Row label="You receive" value={`${fmtTokens(quote.tokens)} ${ticker}`} />
                    <Row label="Curve contribution" value={fmtSats(quote.curveContributionSats)} />
                    <Row label="Platform fee (1%)" value={fmtSats(quote.platformFeeSats)} />
                    <Row label="Est. network fee" value={fmtSats(quote.estimatedMinerFeeSats)} />
                    <div className="border-t border-border pt-2">
                      <Row label="Total wallet spend" value={fmtSats(quote.totalEstimatedSpendSats)} strong />
                    </div>
                    <Row label="Stage" value={`${quote.startingStage} → ${quote.endingStage}`} />
                    {quote.feeWarning && (
                      <p className="text-xs text-warning">Network fee is high relative to your mint.</p>
                    )}
                    {quote.feeBlocked && (
                      <p className="text-xs text-danger">Network fee exceeds 50% of contribution — blocked.</p>
                    )}
                    <button
                      onClick={() => void build()}
                      disabled={busy || quote.feeBlocked}
                      className="mt-1 w-full rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-bright disabled:opacity-40"
                    >
                      Review transaction
                    </button>
                  </div>
                )}

                {step === "review" && unsigned && quote && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-bg p-4 text-sm">
                      <p className="mb-2 text-xs text-gray-400">Review outputs before signing:</p>
                      <Row label="Sending" value={fmtSats(quote.totalEstimatedSpendSats)} />
                      <Row label="Receiving" value={`${fmtTokens(quote.tokens)} ${ticker}`} />
                      <Row label="Platform fee" value={fmtSats(quote.platformFeeSats)} />
                      <Row label="Network fee" value={fmtSats(quote.estimatedMinerFeeSats)} />
                    </div>
                    <p className="text-xs text-gray-500">
                      CRC Launch will never ask for your seed phrase or private key.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setStep("quote")} className="flex-1 rounded-xl border border-border py-3 text-gray-200">
                        Back
                      </button>
                      <button
                        onClick={() => void signAndBroadcast()}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-bright disabled:opacity-40"
                      >
                        Sign &amp; Mint
                      </button>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={strong ? "font-semibold text-white" : "font-mono-nums text-gray-200"}>{value}</span>
    </div>
  );
}
