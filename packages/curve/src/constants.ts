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
export const TOTAL_SUPPLY_TOKENS: DisplayTokens = 21_000_000n;
export const PUBLIC_SUPPLY_TOKENS: DisplayTokens = 21_000_000n;
export const GRADUATION_RESERVE_TOKENS: DisplayTokens = 0n;
/** Alias matching the DB column name `reserve_supply_atoms`. */
export const RESERVE_SUPPLY_TOKENS: DisplayTokens = GRADUATION_RESERVE_TOKENS;
export const CREATOR_PREMINE_TOKENS: DisplayTokens = 0n;
export const TEAM_ALLOCATION_TOKENS: DisplayTokens = 0n;

/**
 * The curve is an even staircase: 210 stairs of 100,000 tokens. Tokens are
 * minted and redeemed in lots of 1,000, and every lot on a stair costs the
 * same. Each stair is LOT_STEP_SATS dearer per lot than the last, so the
 * price climbs by the same amount at every step, from near zero: 33 sats a
 * lot on the first stair, 6,930 on the last, 73,111,500 sats for the whole supply.
 */
export const STAGE_COUNT = 210;
export const TOKENS_PER_STAGE: DisplayTokens = 100_000n;
/** Mints and redemptions move whole lots. */
export const LOT_TOKENS: DisplayTokens = 1_000n;
/** Price of one lot on the first stair, in sats. */
export const LOT_BASE_SATS: Sats = 27n;
/** How much dearer a lot is on each stair than on the one below. */
export const LOT_STEP_SATS: Sats = 27n;

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
 * Price of each stair, index 0 = stair 1, in satoshis per PRICE_UNIT_TOKENS
 * (1,000,000 display tokens) — i.e. the lot price × 1,000. Integer only.
 */
export const STAGE_PRICES_SATS_PER_MILLION: readonly Sats[] = Object.freeze(
  Array.from({ length: STAGE_COUNT }, (_, i) =>
    (LOT_BASE_SATS + LOT_STEP_SATS * BigInt(i)) * (PRICE_UNIT_TOKENS / LOT_TOKENS),
  ),
);
