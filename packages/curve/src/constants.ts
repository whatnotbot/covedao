import type { BasisPoints, Sats, TokenAtoms } from "./types.js";

/**
 * V1 standardized tokenomics. These are immutable and are never user
 * configurable. All values are integers (atoms / satoshis).
 */
export const TOTAL_SUPPLY_ATOMS: TokenAtoms = 1_000_000_000n;
export const PUBLIC_SUPPLY_ATOMS: TokenAtoms = 840_000_000n;
export const GRADUATION_RESERVE_ATOMS: TokenAtoms = 160_000_000n;
/** Alias matching the DB column name `reserve_supply_atoms`. */
export const RESERVE_SUPPLY_ATOMS: TokenAtoms = GRADUATION_RESERVE_ATOMS;
export const CREATOR_PREMINE_ATOMS: TokenAtoms = 0n;
export const TEAM_ALLOCATION_ATOMS: TokenAtoms = 0n;

export const STAGE_COUNT = 20;
export const TOKENS_PER_STAGE: TokenAtoms = 42_000_000n;

/** Base minimum curve contribution in satoshis. */
export const MIN_CONTRIBUTION_SATS: Sats = 1_000n;

/** Platform primary-mint fee: 1% = 100 basis points. */
export const PRIMARY_MINT_FEE_BPS: BasisPoints = 100n;

/** Satoshis per 1M tokens = 1_000_000 token atoms. */
export const PRICE_UNIT_ATOMS: TokenAtoms = 1_000_000n;

/**
 * Canonical V1 Progressive Mint Curve table.
 * Index 0 = Stage 1 … Index 19 = Stage 20.
 * Price is satoshis per 1,000,000 tokens. This table is canonical; it must
 * never be recomputed from a float approximation.
 */
export const STAGE_PRICES_SATS_PER_MILLION: readonly Sats[] = Object.freeze([
  500n, 675n, 912n, 1_231n, 1_661n, 2_243n, 3_027n, 4_087n, 5_517n, 7_447n,
  10_054n, 13_572n, 18_323n, 24_735n, 33_393n, 45_080n, 60_857n, 82_157n,
  110_912n, 149_731n,
] as const);
