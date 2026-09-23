import type { Sats } from "@crclaunch/curve";

/**
 * Immutable Cove V1 protocol configuration. Consensus-critical values are
 * frozen here; environment variables may NOT change them for an activated
 * protocol version (they may only specify RPC URL / DB URL / poll interval).
 */
export interface CoveConfig {
  network: "signet" | "regtest" | "mutinynet" | "mainnet";
  /** First canonical block for Cove V1; Cove-looking txs below this are ignored. */
  genesisHeight: number;
  /** Canonical settlement/reserve script (mint combined curve+fee output). */
  settlementScript: string;
  /** Canonical treasury script (deploy launch-fee output). */
  treasuryScript: string;
  launchFeeSats: Sats;
  primaryMintFeeBps: bigint;
  minContributionSats: Sats;
  /** Safety ceiling on the fee rate (sat/vB) applied by the PSBT builder. */
  maxFeeRateSatVb: bigint;
  /** Safety ceiling on the total miner fee (sats) applied by the PSBT builder. */
  maxMinerFeeSats: Sats;
}

/**
 * Cove V1 signet activation height. Chosen as the signet tip at activation
 * (no Cove txs existed before this height). Immutable; canonical replay always
 * begins here (or at a verified checkpoint).
 */
export const COVE_V1_SIGNET_GENESIS_HEIGHT = 323323;

/** Mainnet is NOT activated. */
export const COVE_V1_MAINNET_GENESIS_HEIGHT: number | null = null;

/**
 * Canonical Cove V1 signet config.
 *
 * settlementScript / treasuryScript are real signet P2WPKH scripts controlled
 * by test keys generated for this demo (see docs + .cove-signet-keys.json,
 * which is gitignored). They are destinations (sinks) for the demo; no private
 * keys live in source. Mainnet destinations remain undefined.
 */
export const COVE_V1_SIGNET_CONFIG: CoveConfig = {
  network: "signet",
  genesisHeight: COVE_V1_SIGNET_GENESIS_HEIGHT,
  settlementScript: "001468a5c1ce1047fa51ba0a2170329c3f9396c2a0b8",
  treasuryScript: "0014c168131539d3062ff2c66bd0833a9c5d8c355f46",
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  minContributionSats: 1_000n,
  maxFeeRateSatVb: 50n,
  maxMinerFeeSats: 50_000n,
};

/**
 * Mutinynet (custom signet) Cove config. Same economics and scripts; a SEPARATE
 * network namespace + activation height. Chosen activation height = the
 * Mutinynet tip at proof time (3449383) — no Cove tx existed before it.
 */
export const COVE_MUTINYNET_GENESIS_HEIGHT = 3449383;
export const COVE_MUTINYNET_CONFIG: CoveConfig = {
  network: "mutinynet",
  genesisHeight: COVE_MUTINYNET_GENESIS_HEIGHT,
  settlementScript: "001468a5c1ce1047fa51ba0a2170329c3f9396c2a0b8",
  treasuryScript: "0014c168131539d3062ff2c66bd0833a9c5d8c355f46",
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  minContributionSats: 1_000n,
  maxFeeRateSatVb: 50n,
  maxMinerFeeSats: 50_000n,
};

/**
 * Cove V1 MAINNET config — INCOMPLETE and fail-closed. It must not be used for
 * broadcasting until the owner supplies treasuryScript, settlementScript and an
 * activation height. `genesisHeight: -1` is a sentinel; `isCoveMainnetActivated`
 * returns false until a real activation height + both scripts are present.
 */
export const COVE_V1_MAINNET_CONFIG: CoveConfig = {
  network: "mainnet",
  genesisHeight: -1, // NOT ACTIVATED
  settlementScript: "", // owner must supply
  treasuryScript: "", // owner must supply
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  minContributionSats: 1_000n,
  maxFeeRateSatVb: 50n,
  maxMinerFeeSats: 50_000n,
};

/** True only when a real mainnet activation height and both scripts are set. */
export function isCoveMainnetActivated(cfg: CoveConfig): boolean {
  return cfg.network === "mainnet" && cfg.genesisHeight > 0 && cfg.settlementScript.length > 0 && cfg.treasuryScript.length > 0;
}

/**
 * Canonical serialization of a CoveConfig. Committed into the state root so two
 * indexers running different rules can never agree on the same root.
 */
export function configDomain(cfg: CoveConfig): string {
  return [
    "cove:1",
    cfg.network,
    cfg.genesisHeight.toString(),
    cfg.settlementScript,
    cfg.treasuryScript,
    cfg.launchFeeSats.toString(),
    cfg.primaryMintFeeBps.toString(),
    cfg.minContributionSats.toString(),
  ].join(":");
}
