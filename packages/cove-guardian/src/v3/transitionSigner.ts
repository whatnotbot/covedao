import * as bitcoin from "bitcoinjs-lib";
import { randomUUID } from "node:crypto";
import { stateHashV2, type CoveCanonicalView } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3, type VaultRecoveryProfile } from "@crclaunch/cove-vault";
import { COVE_POLICY_V3 } from "@crclaunch/cove-wire";
import { validateMintTransitionV3, validateRedeemTransitionV3 } from "./validate.js";
import { unsignedTxDigest } from "./resolve.js";
import type { GuardianV3Signer } from "./signer.js";
import type { SigningJournalStore } from "./journal.js";
import type {
  AuditRecord,
  GuardianV3Network,
  MintAnalysis,
  RedeemAnalysis,
  SignedTransitionResult,
} from "./types.js";

/**
 * Phase 8 Guardian service boundary (§12-§15, §17-§24). A `GuardianTransitionSigner`
 * is the application-facing signing boundary: it only signs MINT/REDEEM (never
 * arbitrary data), and the LOCAL implementation persists a VALIDATED_TO_SIGN
 * audit + reserves the backing outpoint BEFORE producing any signature — audit
 * failure aborts the signature, and a conflicting digest is refused.
 */

export interface DurableAuditSink {
  /** MUST be durably persisted before any signature; rejection aborts signing. */
  writeBeforeSign(record: AuditRecord): Promise<{ auditHash: string }>;
  writeAfterSign(record: AuditRecord, auditHash: string): Promise<void>;
}

export interface TransitionSignRequest {
  psbt: bitcoin.Psbt;
  view: CoveCanonicalView;
  network: GuardianV3Network;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  feeScript: Buffer;
  maxMinerFeeSats?: bigint;
}

export type TransitionSignOutcome =
  | SignedTransitionResult
  | { ok: false; reason: string; detail: string; audit: AuditRecord | null };

/**
 * Phase 8 operational risk policy (§25/§26). Enforced INSIDE the signer so a
 * compromised web/API cannot bypass caps. These are operational brakes, not
 * protocol semantics.
 */
export interface GuardianRiskPolicy {
  maxGrossSats: bigint;
  maxRedeemPayoutSats: bigint;
  maxBackingSats: bigint;
  maxMinerFeeSats: bigint;
  /** null = any token; otherwise an allowlist of tokenId hex (canary mode). */
  allowedTokenIds: string[] | null;
}

export function checkRiskPolicy(policy: GuardianRiskPolicy, analysis: MintAnalysis | RedeemAnalysis, operation: "MINT" | "REDEEM"): string | null {
  const tokenId = analysis.tokenId.toString("hex");
  if (policy.allowedTokenIds && !policy.allowedTokenIds.includes(tokenId)) {
    return `token ${tokenId} is not in the canary allowlist`;
  }
  if (analysis.grossSats > policy.maxGrossSats) return `gross ${analysis.grossSats} exceeds cap ${policy.maxGrossSats}`;
  if (analysis.nextState.backingSats > policy.maxBackingSats) return `next backing ${analysis.nextState.backingSats} exceeds cap ${policy.maxBackingSats}`;
  if (analysis.minerFeeSats > policy.maxMinerFeeSats) return `miner fee ${analysis.minerFeeSats} exceeds cap ${policy.maxMinerFeeSats}`;
  if (operation === "REDEEM" && (analysis as RedeemAnalysis).netPayoutSats > policy.maxRedeemPayoutSats) {
    return `redeem payout exceeds cap ${policy.maxRedeemPayoutSats}`;
  }
  return null;
}

export interface GuardianTransitionSigner {
  signMint(req: TransitionSignRequest): Promise<TransitionSignOutcome>;
  signRedeem(req: TransitionSignRequest): Promise<TransitionSignOutcome>;
  health(): Promise<{ reachable: boolean; reason?: string }>;
}

function buildAuditRecord(params: {
  operation: "MINT" | "REDEEM";
  network: GuardianV3Network;
  psbt: bitcoin.Psbt;
  analysis: MintAnalysis | RedeemAnalysis;
  expectedCmr: string | null;
  actualCmr: string | null;
  simplicityResult: "PASS" | "FAIL";
  decision: "VALID_TO_SIGN" | "REJECTED";
  rejectionReason: string | null;
}): AuditRecord {
  const a = params.analysis;
  const tokenId = a.tokenId.toString("hex");
  const prev = "prevStateHash" in a ? a.currentState : a.currentState;
  return {
    requestId: randomUUID(),
    operation: params.operation,
    tokenId,
    prevStateHash: stateHashV2(prev),
    nextStateHash: stateHashV2(a.nextState),
    backingOutpoint: a.backingOutpoint,
    tokenInputOutpoints: params.operation === "REDEEM" ? (a as RedeemAnalysis).tokenInputOutpoints : [],
    amountAtoms: params.operation === "MINT" ? (a as MintAnalysis).amountAtoms : (a as RedeemAnalysis).redeemAmountAtoms,
    grossSats: a.grossSats,
    protocolFeeSats: a.protocolFeeSats,
    minerFeeSats: a.minerFeeSats,
    policyVersion: COVE_POLICY_V3,
    expectedCmr: params.expectedCmr ?? "",
    actualCmr: params.actualCmr ?? "",
    simplicityResult: params.simplicityResult,
    referencePolicyResult: "PASS",
    unsignedTxDigest: unsignedTxDigest(params.psbt),
    network: params.network,
    decision: params.decision,
    rejectionReason: params.rejectionReason,
    timestamp: new Date().toISOString(),
  };
}

/** Local (non-mainnet) signer: durable-before-sign audit + journal + sign. */
export class LocalGuardianTransitionSigner implements GuardianTransitionSigner {
  constructor(
    private readonly signer: GuardianV3Signer,
    private readonly journal: SigningJournalStore,
    private readonly audit: DurableAuditSink,
    private readonly riskPolicy: GuardianRiskPolicy,
  ) {}

  async signMint(req: TransitionSignRequest): Promise<TransitionSignOutcome> {
    return this.sign(req, "MINT");
  }
  async signRedeem(req: TransitionSignRequest): Promise<TransitionSignOutcome> {
    return this.sign(req, "REDEEM");
  }
  async health(): Promise<{ reachable: boolean }> {
    return { reachable: true };
  }

  private async sign(req: TransitionSignRequest, op: "MINT" | "REDEEM"): Promise<TransitionSignOutcome> {
    const validate = op === "MINT"
      ? validateMintTransitionV3({ ...req, guardianXOnly: this.signer.xOnlyPubkey() })
      : validateRedeemTransitionV3({ ...req, guardianXOnly: this.signer.xOnlyPubkey() });
    if (!validate.ok) {
      return { ok: false, reason: validate.reason, detail: validate.detail, audit: null };
    }
    const analysis = validate.analysis;

    // 0. Risk policy (operational brake) enforced BEFORE audit/sign.
    const risk = checkRiskPolicy(this.riskPolicy, analysis, op);
    if (risk) {
      return { ok: false, reason: "RISK_POLICY_REJECTED", detail: risk, audit: null };
    }

    const record = buildAuditRecord({
      operation: op,
      network: req.network,
      psbt: req.psbt,
      analysis,
      expectedCmr: validate.simplicity.expectedCmr,
      actualCmr: validate.simplicity.actualCmr,
      simplicityResult: validate.simplicity.result,
      decision: "VALID_TO_SIGN",
      rejectionReason: null,
    });

    // 1. Durable-before-sign audit. Failure → NO signature.
    let receipt: { auditHash: string };
    try {
      receipt = await this.audit.writeBeforeSign(record);
    } catch (e) {
      return { ok: false, reason: "AUDIT_PERSISTENCE_FAILED", detail: (e as Error).message, audit: record };
    }

    // 2. Reserve the backing outpoint (double-sign protection).
    const reservation = await this.journal.reserve({
      network: req.network,
      backingTxid: record.backingOutpoint.txid,
      backingVout: record.backingOutpoint.vout,
      unsignedTxDigest: record.unsignedTxDigest,
    });
    if (reservation === "CONFLICT") {
      return { ok: false, reason: "BACKING_ALREADY_SIGNED", detail: "backing outpoint already signed with a different digest", audit: record };
    }

    // 3. Sign (script-path execution leaf).
    const guardianXOnly = this.signer.xOnlyPubkey();
    const prevVault = buildBackingVaultV3({
      state: analysis.currentState,
      guardianXOnly,
      recoveryKeyXOnly: req.recoveryKeyXOnly,
      recoveryProfile: req.recoveryProfile,
      network: req.network === "regtest" ? bitcoin.networks.regtest : req.network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet,
    });
    const leaf = op === "MINT" ? prevVault.mintLeaf : prevVault.redeemLeaf;
    const control = op === "MINT" ? prevVault.mintControlBlock : prevVault.redeemControlBlock;
    this.signer.signVaultExecutionLeaf(req.psbt, 0, leaf, control);

    await this.audit.writeAfterSign(record, receipt.auditHash).catch(() => {});

    return {
      ok: true,
      operation: op,
      tokenId: record.tokenId,
      prevStateHash: record.prevStateHash,
      nextStateHash: record.nextStateHash,
      expectedCmr: record.expectedCmr,
      actualCmr: record.actualCmr,
      simplicityResult: record.simplicityResult,
      referencePolicyResult: "PASS",
      backingOutpoint: record.backingOutpoint,
      signedInputIndex: 0,
      audit: record,
    };
  }
}

/** Production remote signer stub: mainnet requires a real custody backend. */
export class RemoteGuardianTransitionSigner implements GuardianTransitionSigner {
  constructor(private readonly endpoint: string) {}
  async signMint(_req: TransitionSignRequest): Promise<TransitionSignOutcome> {
    throw new Error("MAINNET_SIGNER_NOT_READY: no production custody backend configured");
  }
  async signRedeem(_req: TransitionSignRequest): Promise<TransitionSignOutcome> {
    throw new Error("MAINNET_SIGNER_NOT_READY: no production custody backend configured");
  }
  async health(): Promise<{ reachable: boolean; reason: string }> {
    return { reachable: false, reason: `no production custody backend at ${this.endpoint}` };
  }
}
