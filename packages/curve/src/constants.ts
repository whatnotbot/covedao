import type { Atoms, BasisPoints, DisplayTokens, Sats } from "./types.js";

/**
 * V1 standardized tokenomics. Immutable; never user configurable.
 *
 * TWO equivalent unit families are exported so callers are unambiguous:
 *   - `*_TOKENS` — display tokens (the economics/pricing unit).
 *   - `*_ATOMS`  — atoms (the canonical 8-decimal ledger unit).
 *
 * 1 display token = ATOMS_PER_TOKEN atoms. Pricing is expressed in sats per
 * PRICE_UNIT_TOKENS (= 1,000,000 display tokens = PRICE_UNIT_ATOMS atoms).
 */

/** 8 decimal places: 1 display token = 100,000,000 atoms. */
export const DECIMALS = 8;
export const ATOMS_PER_TOKEN: Atoms = 10n ** BigInt(DECIMALS);

// ── Display-token-denominated supply (the human/economic unit) ──────────────
export const TOTAL_SUPPLY_TOKENS: DisplayTokens = 1_000_000_000n;
export const PUBLIC_SUPPLY_TOKENS: DisplayTokens = 840_000_000n;
export const GRADUATION_RESERVE_TOKENS: DisplayTokens = 160_000_000n;
/** Alias matching the DB column name `reserve_supply_atoms`. */
export const RESERVE_SUPPLY_TOKENS: DisplayTokens = GRADUATION_RESERVE_TOKENS;
export const CREATOR_PREMINE_TOKENS: DisplayTokens = 0n;
export const TEAM_ALLOCATION_TOKENS: DisplayTokens = 0n;

export const STAGE_COUNT = 20;
export const TOKENS_PER_STAGE: DisplayTokens = 42_000_000n;

/** Satoshis per 1,000,000 display tokens. */
export const PRICE_UNIT_TOKENS: DisplayTokens = 1_000_000n;

// ── Atom-denominated supply (the canonical on-chain ledger unit) ────────────
export const TOTAL_SUPPLY_ATOMS: Atoms = TOTAL_SUPPLY_TOKENS * ATOMS_PER_TOKEN;
export const PUBLIC_SUPPLY_ATOMS: Atoms = PUBLIC_SUPPLY_TOKENS * ATOMS_PER_TOKEN;
export const GRADUATION_RESERVE_ATOMS: Atoms = GRADUATION_RESERVE_TOKENS * ATOMS_PER_TOKEN;
export const RESERVE_SUPPLY_ATOMS: Atoms = GRADUATION_RESERVE_ATOMS;
export const TOKENS_PER_STAGE_ATOMS: Atoms = TOKENS_PER_STAGE * ATOMS_PER_TOKEN;

/** Satoshis per 1,000,000 display tokens expressed in atoms (= 1e14). */
export const PRICE_UNIT_ATOMS: Atoms = PRICE_UNIT_TOKENS * ATOMS_PER_TOKEN;

/** Base minimum curve contribution in satoshis. */
export const MIN_CONTRIBUTION_SATS: Sats = 1_000n;

/** Platform primary-mint fee: 1% = 100 basis points. */
export const PRIMARY_MINT_FEE_BPS: BasisPoints = 100n;

/**
 * Canonical V1 Progressive Mint Curve table.
 * Index 0 = Stage 1 … Index 19 = Stage 20.
 * Price is satoshis per PRICE_UNIT_TOKENS (1,000,000 display tokens).
 * Canonical; never recomputed from a float approximation.
 */
export const STAGE_PRICES_SATS_PER_MILLION: readonly Sats[] = Object.freeze([
  500n, 675n, 912n, 1_231n, 1_661n, 2_243n, 3_027n, 4_087n, 5_517n, 7_447n,
  10_054n, 13_572n, 18_323n, 24_735n, 33_393n, 45_080n, 60_857n, 82_157n,
  110_912n, 149_731n,
] as const);
