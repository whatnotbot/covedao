/**
 * Domain types. Branded `bigint`/`string` aliases keep monetary code from
 * being confused with ordinary numbers. Function signatures always use
 * explicit object parameters and named units (Sats / TokenAtoms / ...).
 */
export type Sats = bigint;
export type TokenAtoms = bigint;
export type BlockHeight = bigint;
export type BasisPoints = bigint;
export type TxId = string;
