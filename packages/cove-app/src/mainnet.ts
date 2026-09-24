import { AppError } from "./errors.js";

/**
 * Phase 8 mainnet activation machinery (§27-§34, §42-§44). Mainnet is a
 * deterministic function of a committed PUBLIC profile + canary manifest +
 * operational health — never a single boolean. Fresh/missing/unknown config is
 * DISABLED. Consensus/economic values are committed profile constants; runtime
 * env must NOT redefine them.
 */

export type MainnetStage =
  | "DISABLED"
  | "READ_ONLY"
  | "SHADOW"
  | "CANARY_READY"
  | "CANARY_ACTIVE"
  | "CANARY_COMPLETE"
  | "PUBLIC_READY"
  | "PUBLIC_ACTIVE";

export interface MainnetRecoveryProfile {
  threshold: number;
  pubkeys: string[]; // 64-hex x-only
  csvBlocks: number;
}

export interface MainnetProfile {
  profileVersion: number;
  chainIdentity: "bitcoin-mainnet";
  /** null until the operator commits a live height (§33). */
  activationHeight: bigint | null;
  policyVersion: 3;
  vaultProfileVersion: string;
  /** null until custody ceremony commits it (§15/§145). */
  guardianXOnly: string | null;
  recovery: MainnetRecoveryProfile;
  /** null until the operator commits the fee destination script (§35). */
  feeScript: string | null;
  buyFeeBps: bigint | null;
  redeemFeeBps: bigint | null;
  p2pFeeBps: bigint | null;
  carrierSats: bigint;
  anchorSats: bigint;
  maxProtocolSupply: bigint;
  reserveAllocation: bigint;
  mintCmr: string;
  redeemCmr: string;
}

/** Operator decisions that are required before canary and are NEVER inferred. */
export const OWNER_DECISION_KEYS = [
  "activationHeight",
  "guardianXOnly",
  "recovery.pubkeys",
  "recovery.csvBlocks",
  "feeScript",
  "buyFeeBps",
  "redeemFeeBps",
  "p2pFeeBps",
] as const;

export function mainnetProfileComplete(p: MainnetProfile): boolean {
  return (
    p.activationHeight !== null &&
    p.activationHeight > 0n &&
    p.guardianXOnly !== null &&
    /^[0-9a-f]{64}$/i.test(p.guardianXOnly) &&
    p.recovery.pubkeys.length >= p.recovery.threshold &&
    p.recovery.pubkeys.every((k) => /^[0-9a-f]{64}$/i.test(k)) &&
    p.recovery.csvBlocks > 0 &&
    p.feeScript !== null &&
    /^[0-9a-f]+$/i.test(p.feeScript) &&
    p.buyFeeBps !== null && p.buyFeeBps > 0n &&
    p.redeemFeeBps !== null && p.redeemFeeBps > 0n &&
    p.p2pFeeBps !== null && p.p2pFeeBps > 0n
  );
}

export interface MainnetHealth {
  primaryCoreHealthy: boolean;
  secondaryCoreHealthy: boolean;
  coreAgreement: boolean;
  indexerHealthy: boolean;
  stateRootVerified: boolean;
  workerHealthy: boolean;
  guardianHealthy: boolean;
  auditHealthy: boolean;
  signingJournalHealthy: boolean;
  profileHashMatches: boolean;
}

/**
 * Deterministic mainnet activation stage (§27/§28). Default DISABLED. A canary
 * can only be ACTIVE when the profile is complete, the profile hash matches,
 * and every required health signal is green.
 */
export function deriveMainnetStage(p: MainnetProfile, canaryActive: boolean, health: MainnetHealth): MainnetStage {
  if (!mainnetProfileComplete(p)) return "DISABLED";
  if (!health.profileHashMatches) return "DISABLED";
  if (!health.primaryCoreHealthy || !health.coreAgreement || !health.indexerHealthy) return "READ_ONLY";
  if (!health.stateRootVerified || !health.workerHealthy) return "READ_ONLY";
  if (!health.guardianHealthy || !health.auditHealthy || !health.signingJournalHealthy) return "READ_ONLY";
  if (!canaryActive) return "CANARY_READY";
  return "CANARY_ACTIVE";
}

/** Mainnet web/worker MUST NOT load a local Guardian key (§11/§43). */
export function assertNoLocalGuardianKeyOnMainnet(network: string, guardianPrivateKey: Buffer | null): void {
  if (network === "mainnet" && guardianPrivateKey !== null) {
    throw new AppError("MAINNET_DISABLED", "mainnet must use the remote Guardian service; local Guardian key is forbidden");
  }
}

/** Mainnet MUST NOT load a recovery private key (§44). Recovery is offline. */
export function assertNoRecoveryPrivateKeyOnMainnet(network: string, recoveryPrivateKey: Buffer | null): void {
  if (network === "mainnet" && recoveryPrivateKey !== null) {
    throw new AppError("MAINNET_DISABLED", "mainnet recovery private keys are offline-only and forbidden in the app");
  }
}

/** List the OWNER_DECISION_REQUIRED keys still missing from a profile (§145). */
export function missingOwnerDecisions(p: MainnetProfile): string[] {
  const missing: string[] = [];
  if (p.activationHeight === null) missing.push("activationHeight");
  if (p.guardianXOnly === null) missing.push("guardianXOnly");
  if (p.recovery.pubkeys.length === 0) missing.push("recovery.pubkeys");
  if (p.recovery.csvBlocks <= 0) missing.push("recovery.csvBlocks");
  if (p.feeScript === null) missing.push("feeScript");
  if (p.buyFeeBps === null) missing.push("buyFeeBps");
  if (p.redeemFeeBps === null) missing.push("redeemFeeBps");
  if (p.p2pFeeBps === null) missing.push("p2pFeeBps");
  return missing;
}
