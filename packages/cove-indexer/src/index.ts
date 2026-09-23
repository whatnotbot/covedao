/**
 * LEGACY / REFERENCE — OP_RETURN Cove V1 + indexer-authoritative balances.
 * Not the production token protocol; see packages/cove-covenant and
 * docs/COVE_COVENANT_ARCHITECTURE.md. Do not reactivate as balance authority.
 */
export { CoveIndexer } from "./indexer.js";
export type {
  CoveIndexEvent,
  ProcessTxResult,
  CoveIndexStats,
  CoveTxClassification,
} from "./indexer.js";
export { COVE_SIGNET_CONFIG } from "./config.js";
