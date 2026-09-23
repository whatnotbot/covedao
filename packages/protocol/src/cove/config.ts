import type { Sats } from "@crclaunch/curve";

/**
 * Immutable Cove V1 protocol configuration. Consensus-critical values are
 * frozen here; environment variables may NOT change them for an activated
 * protocol version (they may only specify RPC URL / DB URL / poll interval).
 */
export interface CoveConfig {
  network: "signet" | "regtest";
  /** First canonical block for Cove V1; Cove-looking txs below this are ignored. */
  genesisHeight: number;
  /** Canonical settlement/reserve script (mint combined curve+fee output). */
  settlementScript: string;
  /** Canonical treasury script (deploy launch-fee output). */
  treasuryScript: string;
  launchFeeSats: Sats;
  primaryMintFeeBps: bigint;
  minContributionSats: Sats;
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
};
