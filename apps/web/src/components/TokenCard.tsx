import Link from "next/link";
import { fmtPricePerMillion, fmtProgressBps, fmtTokens } from "@/lib/format";

export interface TokenCardData {
  deploymentTxid: string;
  ticker: string;
  name: string;
  status: string;
  confirmedMintedAtoms: string;
  publicSupplyAtoms: string;
  currentStage: number;
  currentPriceSatsPerMillion: string;
  progressBps: number;
  reserveSats: string;
  lastTradePricePerMillion: string | null;
}

export function TokenCard({ token }: { token: TokenCardData }) {
  const pct = Math.max(0, Math.min(100, token.progressBps / 100));
  return (
    <Link
      href={`/token/${token.deploymentTxid}`}
      className="group block rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/60"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-bold text-white">
            {token.ticker}
            <span className="ml-2 text-sm font-normal text-gray-400">{token.name}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Stage {token.currentStage} / 20
          </div>
        </div>
        {token.status === "GRADUATED" && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">Graduated</span>
        )}
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-400">
          <span>{fmtProgressBps(token.progressBps)} minted</span>
          <span>
            {fmtTokens(token.confirmedMintedAtoms)} / {fmtTokens(token.publicSupplyAtoms)}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 text-sm text-gray-300">
        {token.status === "GRADUATED" && token.lastTradePricePerMillion
          ? fmtPricePerMillion(token.lastTradePricePerMillion)
          : fmtPricePerMillion(token.currentPriceSatsPerMillion)}
      </div>
    </Link>
  );
}
