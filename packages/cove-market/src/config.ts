import { COVE_FEE_CONFIG } from "@crclaunch/cove-economics";

/**
 * Market operational config (§29/§22/§10). NOT Cove protocol constants — these
 * are production/dev operational values.
 */
export interface MarketConfig {
  enabled: boolean;
  network: "regtest" | "signet" | "testnet" | "mainnet";
  p2pFeeBps: bigint;
  feeScript: Buffer;
  reservationTtlSeconds: number;
  maxListingBlocks: bigint;
  maxMinerFeeSats: bigint;
  /** Canary P2P settlement cap (sats); undefined = uncapped (dev/regtest only). */
  maxP2pSettlementSats?: bigint;
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

/**
 * Explicit mainnet market config driven by the committed public profile (§16/§17).
 * NEVER falls back to development economics: p2pFeeBps + feeScript + the canary
 * P2P cap come from the profile, not COVE_FEE_CONFIG dev defaults.
 */
export function mainnetMarketConfig(params: {
  p2pFeeBps: number;
  feeScript: Buffer;
  maxP2pSettlementSats: bigint;
}): MarketConfig {
  return {
    enabled: true,
    network: "mainnet",
    p2pFeeBps: BigInt(params.p2pFeeBps),
    feeScript: params.feeScript,
    reservationTtlSeconds: 90,
    maxListingBlocks: 21_000n,
    maxMinerFeeSats: 20_000n,
    maxP2pSettlementSats: params.maxP2pSettlementSats,
  };
}
