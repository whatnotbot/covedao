import { getPublicMintProgress, getStagePrice, STAGE_COUNT } from "@crclaunch/curve";
import type { schema } from "@crclaunch/db";

type TokenRow = typeof schema.tokens.$inferSelect;
type MetaRow = typeof schema.tokenMetadata.$inferSelect;

export interface TokenView {
  deploymentTxid: string;
  ticker: string;
  name: string;
  creatorAddress: string;
  network: string;
  status: string;
  totalSupplyAtoms: string;
  publicSupplyAtoms: string;
  reserveSupplyAtoms: string;
  confirmedMintedAtoms: string;
  pendingMintedAtoms: string;
  reserveSats: string;
  currentStage: number;
  currentPriceSatsPerMillion: string;
  nextStagePriceSatsPerMillion: string | null;
  progressBps: number;
  remainingPublicAtoms: string;
  deployHeight: string | null;
  lastTradePricePerMillion: string | null;
  description: string;
  websiteUrl: string | null;
  xUrl: string | null;
  imageUrl: string | null;
  isVerified: boolean;
  createdAt: string;
}

export function tokenView(t: TokenRow, meta?: MetaRow | null): TokenView {
  const nextStage = t.currentStage < STAGE_COUNT ? t.currentStage + 1 : null;
  const remaining = t.publicSupplyAtoms - t.confirmedMintedAtoms;
  return {
    deploymentTxid: t.deploymentTxid,
    ticker: t.ticker,
    name: t.name,
    creatorAddress: t.creatorAddress,
    network: t.network,
    status: t.status,
    totalSupplyAtoms: t.totalSupplyAtoms.toString(),
    publicSupplyAtoms: t.publicSupplyAtoms.toString(),
    reserveSupplyAtoms: t.reserveSupplyAtoms.toString(),
    confirmedMintedAtoms: t.confirmedMintedAtoms.toString(),
    pendingMintedAtoms: t.pendingMintedAtoms.toString(),
    reserveSats: t.reserveSats.toString(),
    currentStage: t.currentStage,
    currentPriceSatsPerMillion: getStagePrice(t.currentStage).toString(),
    nextStagePriceSatsPerMillion: nextStage ? getStagePrice(nextStage).toString() : null,
    progressBps: getPublicMintProgress(t.confirmedMintedAtoms).bps,
    remainingPublicAtoms: (remaining < 0n ? 0n : remaining).toString(),
    deployHeight: t.deployHeight?.toString() ?? null,
    lastTradePricePerMillion: t.lastTradePricePerMillion?.toString() ?? null,
    description: meta?.description ?? "",
    websiteUrl: meta?.websiteUrl ?? null,
    xUrl: meta?.xUrl ?? null,
    imageUrl: meta?.imageUrl ?? null,
    isVerified: meta?.isVerified ?? false,
    createdAt: t.createdAt.toISOString(),
  };
}
