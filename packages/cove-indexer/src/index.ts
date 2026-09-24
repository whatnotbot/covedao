/**
 * LEGACY / REFERENCE — OP_RETURN Cove V1 + indexer-authoritative balances.
 * NOT the production token protocol. The production Cove V3 indexer lives in
 * `./v3` (import `@crclaunch/cove-indexer/v3`). This entrypoint is kept only for
 * historical compatibility; do not use it as balance authority or as the
 * production indexer.
 */
export { CoveIndexer } from "./indexer.js";
export type {
  CoveIndexEvent,
  ProcessTxResult,
  CoveIndexStats,
  CoveTxClassification,
} from "./indexer.js";
export { COVE_SIGNET_CONFIG } from "./config.js";
