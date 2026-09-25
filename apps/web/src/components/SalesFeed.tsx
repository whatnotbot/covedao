"use client";

import { fmtInt, fmtBtc } from "@/lib/format";

/**
 * Settled sales for a token: a scatter of recent fill sizes and the ledger of
 * confirmed trades beneath it.
 *
 * Every row is a real Bitcoin transaction. The txid is shown rather than hidden
 * behind a label, because the whole claim of this product is that a reader can
 * go and check.
 */

export interface Sale {
  txid: string;
  blockHeight: string;
  at: string;
  amountTokens: number;
  unitPriceSats: number;
  totalPriceSats: string;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Scatter of the most recent fills, sized by value. */
function Scatter({ sales }: { sales: Sale[] }) {
  const pts = sales.slice(0, 120).reverse();
  if (pts.length < 2) return null;
  const vals = pts.map((s) => Number(s.totalPriceSats));
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;

  return (
    <div className="relative h-40 border border-rule bg-ink px-2 pb-6 pt-3">
      <div className="flex h-full items-end gap-[3px]">
        {pts.map((s, i) => {
          const v = Number(s.totalPriceSats);
          const h = 6 + ((v - min) / span) * 88;
          return (
            <div key={s.txid + i} className="group relative flex-1" style={{ height: "100%" }}>
              <span
                className="absolute left-1/2 w-px -translate-x-1/2 bg-rule-bright"
                style={{ bottom: 0, height: `${h}%` }}
                aria-hidden
              />
              <span
                className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-signal transition-transform group-hover:scale-150"
                style={{ bottom: `calc(${h}% - 3px)` }}
                title={`${fmtInt(s.amountTokens)} tokens · ${fmtBtc(BigInt(s.totalPriceSats))}`}
              />
            </div>
          );
        })}
      </div>
      <div className="absolute inset-x-2 bottom-1.5 flex justify-between text-label uppercase tracking-label text-bone-dim">
        <span>{when(pts[0]!.at)}</span>
        <span>latest {pts.length} sales</span>
        <span>{when(pts[pts.length - 1]!.at)}</span>
      </div>
    </div>
  );
}

export function SalesFeed({ sales, explorerBase }: { sales: Sale[]; explorerBase?: string }) {
  if (sales.length === 0) {
    return (
      <div className="border border-dashed border-rule px-6 py-14 text-center text-sm text-bone-dim">
        No confirmed sales yet.
      </div>
    );
  }
  const shown = sales.slice(0, 40);
  return (
    <div>
      <Scatter sales={sales} />
      <div className="mt-5 flex items-baseline justify-between">
        <p className="eyebrow">Confirmed sales</p>
        <span className="text-label uppercase tracking-label text-bone-dim">
          {fmtInt(shown.length)} of {fmtInt(sales.length)}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="ledger-table min-w-[44rem]">
          <thead>
            <tr>
              <th>Time</th>
              <th>Transaction</th>
              <th>Tokens</th>
              <th>Unit · sats/1M</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.txid} className="transition-colors hover:bg-ink-3">
                <td className="whitespace-nowrap text-bone-dim">{when(s.at)}</td>
                <td className="hex">
                  {explorerBase ? (
                    <a
                      href={`${explorerBase}/tx/${s.txid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-bone-dim underline decoration-rule-bright underline-offset-2 hover:text-signal"
                    >
                      {s.txid.slice(0, 10)}…{s.txid.slice(-6)}
                    </a>
                  ) : (
                    <>
                      {s.txid.slice(0, 10)}…{s.txid.slice(-6)}
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap text-bone-2">{fmtInt(s.amountTokens)}</td>
                <td className="whitespace-nowrap text-bone">{fmtInt(Math.round(s.unitPriceSats))}</td>
                <td className="whitespace-nowrap text-bone-2">{fmtBtc(BigInt(s.totalPriceSats))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
