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

const MAINNET_FEE_CAPS = {
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  minContributionSats: 1_000n,
  maxFeeRateSatVb: 50n,
  maxMinerFeeSats: 50_000n,
} as const;

/**
 * Cove V1 signet activation height. Chosen as the signet tip at activation
 * (no Cove txs existed before this height). Immutable; canonical replay always
 * begins here (or at a verified checkpoint).
 */
export const COVE_V1_SIGNET_GENESIS_HEIGHT = 323323;

/**
 * Mainnet is NOT activated. This stays null until the owner (1) supplies the
 * custody addresses and (2) chooses a FUTURE Bitcoin block height H that is
 * committed BEFORE the first mainnet Cove transaction.
 */
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
 * Regtest config for the real Bitcoin Core CI lifecycle. Arbitrary P2WPKH
 * destination scripts (nobody controls them; regtest is ephemeral). Activation
 * height 1 so canonical replay covers the full ephemeral chain.
 */
export const COVE_V1_REGTEST_CONFIG: CoveConfig = {
  network: "regtest",
  genesisHeight: 1,
  settlementScript: "0014" + "11".repeat(20),
  treasuryScript: "0014" + "22".repeat(20),
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  minContributionSats: 1_000n,
  maxFeeRateSatVb: 50n,
  maxMinerFeeSats: 50_000n,
};

export interface CoveMainnetConfigParams {
  /** FUTURE Bitcoin block height H, committed BEFORE the first mainnet Cove tx. */
  genesisHeight: number;
  /** Owner-supplied settlement/reserve scriptPubKey (P2WPKH/P2TR hex). */
  settlementScript: string;
  /** Owner-supplied treasury scriptPubKey (P2WPKH/P2TR hex). */
  treasuryScript: string;
}

/**
 * Build the ONLY valid Cove V1 mainnet config. There is no default/empty
 * mainnet config and no -1 sentinel: a mainnet config can only exist once the
 * owner has committed a future activation height H and both custody scripts.
 * Any invalid combination throws — there is no code path where a missing
 * activation value silently means "scan from before genesis".
 */
export function makeCoveMainnetConfig(p: CoveMainnetConfigParams): CoveConfig {
  if (!Number.isInteger(p.genesisHeight) || p.genesisHeight < 1) {
    throw new Error(`mainnet genesisHeight must be a future block height >= 1, got ${p.genesisHeight}`);
  }
  if (!/^[0-9a-f]+$/.test(p.settlementScript) || p.settlementScript.length === 0) {
    throw new Error("mainnet settlementScript must be a non-empty hex script");
  }
  if (!/^[0-9a-f]+$/.test(p.treasuryScript) || p.treasuryScript.length === 0) {
    throw new Error("mainnet treasuryScript must be a non-empty hex script");
  }
  return {
    network: "mainnet",
    genesisHeight: p.genesisHeight,
    settlementScript: p.settlementScript.toLowerCase(),
    treasuryScript: p.treasuryScript.toLowerCase(),
    launchFeeSats: MAINNET_FEE_CAPS.launchFeeSats,
    primaryMintFeeBps: MAINNET_FEE_CAPS.primaryMintFeeBps,
    minContributionSats: MAINNET_FEE_CAPS.minContributionSats,
    maxFeeRateSatVb: MAINNET_FEE_CAPS.maxFeeRateSatVb,
    maxMinerFeeSats: MAINNET_FEE_CAPS.maxMinerFeeSats,
  };
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
