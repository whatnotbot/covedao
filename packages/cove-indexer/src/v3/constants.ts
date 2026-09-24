/**
 * Frozen Cove V3 protocol constants used by the indexer. These mirror the
 * guardian's constants but are self-contained (the indexer must not depend on
 * cove-guardian). The core-freeze manifest (packages/cove-guardian/src/
 * frozen-protocol.test.ts) pins them for CI.
 */
export const RESERVE_ANCHOR_SATS = 10_000n;
