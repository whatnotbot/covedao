"use client";

import { useEffect, useState } from "react";

/**
 * What happened to the transaction the user just signed.
 *
 * Broadcasting used to end the story: a txid appeared and nothing ever
 * updated. A transaction can sit unconfirmed for a long time, and it can be
 * dropped from the mempool entirely — in which case the trade never happened
 * and the user needs to know rather than assume. The backend already tracks
 * both; this just says so.
 */

interface TxState {
  txid: string;
  mempool: boolean;
  confirmedHeight: string | null;
  session: { status: string; errorCode: string | null } | null;
}

export function TxStatus({ txid, explorerBase }: { txid: string; explorerBase?: string }) {
  const [state, setState] = useState<TxState | null>(null);

  useEffect(() => {
    if (!txid) return;
    let live = true;
    const poll = () => {
      void fetch(`/api/v3/tx/${txid}`)
        .then((r) => r.json())
        .then((j) => {
          if (live && j.ok) setState(j.data as TxState);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [txid]);

  if (!txid) return null;

  const confirmed = state?.confirmedHeight != null;
  const dropped = state != null && !confirmed && !state.mempool;

  const chip = confirmed ? "chip chip-verified" : dropped ? "chip chip-rejected" : "chip chip-pending";
  const label = confirmed ? "Confirmed" : dropped ? "Dropped" : "In mempool";
  const detail = confirmed
    ? `Settled in block ${state!.confirmedHeight}.`
    : dropped
      ? "Bitcoin dropped this transaction before it was mined. Nothing was spent and nothing was bought — you can try again, and a higher network fee will help it stick."
      : "Waiting for a block. Your BTC is committed but not yet spent; this settles as soon as a miner includes it.";

  return (
    <div className="mt-4 border border-rule bg-ink-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={chip}>{label}</span>
        {explorerBase ? (
          <a
            href={`${explorerBase}/tx/${txid}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-label uppercase tracking-label text-bone-dim hover:text-signal"
          >
            View on explorer →
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-bone-dim">{detail}</p>
      <p className="hex mt-2">{txid}</p>
    </div>
  );
}
