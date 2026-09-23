/**
 * Domain types. Branded `bigint`/`string` aliases keep monetary code from
 * being confused with ordinary numbers. Function signatures always use
 * explicit object parameters and named units.
 *
 * Unit model (frozen for Cove V1):
 *   - `DisplayTokens` — the human/economic unit. 1,000,000,000 total supply.
 *   - `Atoms`        — the canonical 8-decimal ledger unit.
 *                      1 display token = 100,000,000 atoms (ATOMS_PER_TOKEN).
 *   - `Sats`         — Bitcoin satoshis.
 */
export type Sats = bigint;
export type DisplayTokens = bigint;
export type Atoms = bigint;
export type BlockHeight = bigint;
export type BasisPoints = bigint;
export type TxId = string;
