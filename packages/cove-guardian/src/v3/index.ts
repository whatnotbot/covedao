/**
 * Production Cove Guardian V3 — the enforcement / Simplicity signing gate.
 *
 * The ONLY backing-state signing entry points are validateAndSignMintTransition
 * and validateAndSignRedeemTransition. Every path runs: independent parse →
 * canonical reconstruction → real Simplicity execution → independent TS/reference
 * validation → CMR verification → full transaction validation → script-path
 * signing → finalized-tx revalidation.
 */
export {
  GuardianV3Signer,
  type VaultLeafRef,
} from "./signer.js";
export {
  validateAndSignMintTransition,
  validateAndSignRedeemTransition,
  type SignTransitionParams,
  type SignTransitionOutcome,
} from "./guardian.js";
export {
  validateMintTransitionV3,
  validateRedeemTransitionV3,
  type ValidateParams,
} from "./validate.js";
export {
  analyzeMintTransitionV3,
  analyzeRedeemTransitionV3,
  CoveAnalyzeError,
  type AnalyzeParams,
} from "./analyze.js";
export {
  validateFinalizedDeployTransaction,
  validateFinalizedMintTransaction,
  validateFinalizedRedeemTransaction,
  validateFinalizedTransferTransaction,
  type FinalizeParams,
  type FinalValidationResult,
  type FinalValidationRejection,
  type ValidatedCoveTransaction,
  type ResolvedPrevout,
} from "./finalize.js";
export {
  buildCanonicalMintWitness,
  buildCanonicalRedeemWitness,
  type WitnessResult,
} from "./witness.js";
export {
  consoleAuditSink,
  noopAuditSink,
  type AuditSink,
} from "./audit.js";
export {
  broadcastValidatedCoveTransaction,
  type BroadcastResult,
} from "./broadcast.js";
export type {
  CoveCanonicalView,
  GuardianV3Network,
  MintAnalysis,
  RedeemAnalysis,
  CoveAnalysis,
  ValidationResult,
  ValidationOk,
  ValidationRejection,
  ValidationFailureCode,
  SignedTransitionResult,
  AuditRecord,
} from "./types.js";
