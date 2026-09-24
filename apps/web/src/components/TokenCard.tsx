"use client";

import Link from "next/link";
import { fmtBtc, fmtTokens } from "@/lib/format";

export interface V3TokenCardData {
  tokenId: string;
  ticker: string;
  displayName: string;
  description: string;
  deployHeight: string | number;
  issuedSupplyAtoms: string | number | bigint;
  publicCapAtoms: string | number | bigint;
  backingSats: string | number | bigint;
  curveStage: number;
  holderCount: number;
  bestAskSats: string | null;
}

export function TokenCard({ token }: { token: V3TokenCardData }) {
  const issued = BigInt(token.issuedSupplyAtoms);
  const cap = BigInt(token.publicCapAtoms);
  const atCapacity = issued >= cap;
  return (
    <Link
      href={`/token/${token.tokenId}`}
      className="block rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/60"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-white">{token.displayName}</div>
          <div className="text-xs text-gray-500">${token.ticker}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${atCapacity ? "bg-warning/20 text-warning" : "bg-success/20 text-success"}`}>
          {atCapacity ? "AT CAPACITY" : "ACTIVE"}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-gray-400">
        <div className="flex justify-between"><span>Issued / cap</span><span className="text-gray-300">{fmtTokens(issued)} / {fmtTokens(cap)}</span></div>
        <div className="flex justify-between"><span>Backing</span><span className="text-gray-300">{fmtBtc(BigInt(token.backingSats))}</span></div>
        <div className="flex justify-between"><span>Curve stage</span><span className="text-gray-300">{token.curveStage}</span></div>
        <div className="flex justify-between"><span>Holders</span><span className="text-gray-300">{token.holderCount}</span></div>
        {token.bestAskSats ? (
          <div className="flex justify-between"><span>Best P2P ask</span><span className="text-gray-300">{fmtBtc(BigInt(token.bestAskSats))}</span></div>
        ) : null}
      </div>
      <div className="mt-3 truncate font-mono text-[10px] text-gray-600">{token.tokenId.slice(0, 16)}…</div>
    </Link>
  );
}
