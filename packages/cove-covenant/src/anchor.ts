import type { Sats } from "@crclaunch/curve";

/**
 * V3 backing-vault anchor (§6). Every backing vault locks RESERVE_ANCHOR_SATS
 * plus the geometric20 reserve R(s) for its state, so the vault output is never
 * economically dust and the successor value check has a fixed lower bound.
 * FROZEN — do not change.
 */
export const RESERVE_ANCHOR_SATS: Sats = 10_000n;
