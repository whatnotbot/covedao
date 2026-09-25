"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import { ADAPTERS } from "@/lib/wallets/adapters";
import { WalletError, type WalletId } from "@/lib/wallets/types";

/**
 * Pick a wallet.
 *
 * Installed wallets come first and the rest are still listed, with a link to
 * get them — a picker that hides what you do not have looks broken to someone
 * who has not installed anything yet.
 */
const NETWORK = process.env.NEXT_PUBLIC_COVE_NETWORK ?? "regtest";

export function WalletPicker() {
  const { pickerOpen, closePicker, connect } = useWallet();
  const [installed, setInstalled] = useState<Set<WalletId> | null>(null);
  const [busy, setBusy] = useState<WalletId | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pickerOpen) return;
    setError("");
    let cancelled = false;
    void (async () => {
      const found = await Promise.all(
        ADAPTERS.map(async (a) => ((await a.isInstalled()) ? a.id : null)),
      );
      if (!cancelled) setInstalled(new Set(found.filter((id): id is WalletId => id !== null)));
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  const ordered = [...ADAPTERS].sort((a, b) => {
    const ai = installed?.has(a.id) ? 0 : 1;
    const bi = installed?.has(b.id) ? 0 : 1;
    return ai - bi;
  });

  async function pick(id: WalletId) {
    setError("");
    setBusy(id);
    try {
      await connect(id);
    } catch (e) {
      setError(
        e instanceof WalletError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not connect.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePicker();
      }}
    >
      <div className="panel w-full max-w-sm">
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <p className="eyebrow">Connect a wallet</p>
          <button
            onClick={closePicker}
            aria-label="Close"
            className="text-label uppercase tracking-label text-bone-dim hover:text-bone"
          >
            Close
          </button>
        </div>

        <div className="grid gap-px bg-rule">
          {ordered.map((a) => {
            const have = installed?.has(a.id) ?? false;
            const wrongNet = a.mainnetOnly === true && NETWORK !== "mainnet";
            return (
              <button
                key={a.id}
                type="button"
                disabled={busy !== null || (have && wrongNet)}
                onClick={() => (have ? void pick(a.id) : window.open(a.installUrl, "_blank", "noopener"))}
                className="flex items-center justify-between bg-ink-3 px-5 py-4 text-left transition-colors hover:bg-ink-2 disabled:opacity-50"
              >
                <span className="text-sm text-bone">{a.name}</span>
                <span className="text-label uppercase tracking-label text-bone-dim">
                  {busy === a.id
                    ? "Waiting…"
                    : installed === null
                      ? "…"
                      : have && wrongNet
                        ? "Mainnet only"
                        : have
                          ? "Connect"
                          : "Install →"}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="border-t border-rule bg-rejected/10 px-5 py-3 text-xs leading-relaxed text-rejected">
            {error}
          </p>
        ) : null}

        <p className="border-t border-rule px-5 py-4 text-xs leading-relaxed text-bone-dim">
          Cove needs two addresses from your wallet: one holding BTC to pay with, and one holding
          your tokens. Most wallets provide both. Nothing is signed until you approve it.
        </p>
      </div>
    </div>
  );
}
