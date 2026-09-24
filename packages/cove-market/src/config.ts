import { COVE_FEE_CONFIG } from "@crclaunch/cove-economics";

/**
 * Market operational config (§29/§22/§10). NOT Cove protocol constants — these
 * are production/dev operational values.
 */
export interface MarketConfig {
  enabled: boolean;
  network: "regtest" | "signet" | "testnet";
  p2pFeeBps: bigint;
  feeScript: Buffer;
  reservationTtlSeconds: number;
  maxListingBlocks: bigint;
  maxMinerFeeSats: bigint;
}

export function defaultMarketConfig(network: MarketConfig["network"], feeScript: Buffer): MarketConfig {
  return {
    enabled: true,
    network,
    p2pFeeBps: COVE_FEE_CONFIG.p2pFeeBps,
    feeScript,
    reservationTtlSeconds: 90,
    maxListingBlocks: 21_000n, // ~5 months at 10-min blocks; operational, not protocol
    maxMinerFeeSats: 20_000n,
  };
}
