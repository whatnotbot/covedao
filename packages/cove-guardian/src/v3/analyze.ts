import type * as bitcoin from "bitcoinjs-lib";
import {
  applyMintV2,
  applyRedeemV2,
  type CoveStateV2,
} from "@crclaunch/cove-covenant";
import { OP_MINT, OP_REDEEM } from "@crclaunch/cove-wire";
import { COVE_FEE_CONFIG, creatorFeeSats, mintFeeSats, redeemFeeSats } from "@crclaunch/cove-economics";
import { decodeCoveOpReturn, readPsbtInputs, readPsbtOutputs } from "./resolve.js";
import {
  type CoveCanonicalView,
  type GuardianV3Network,
  type MintAnalysis,
  type RedeemAnalysis,
  type ValidationFailureCode,
} from "./types.js";

/**
 * Independent reconstruction of a candidate Cove transition from an ACTUAL
 * PSBT (§8/§10). This never trusts a builder analysis object — it re-parses
 * the PSBT inputs/outputs, decodes the wire envelope, and recomputes the
 * canonical V2 transition from the canonical view.
 */

export class CoveAnalyzeError extends Error {
  readonly code: ValidationFailureCode;
  constructor(code: ValidationFailureCode, message: string) {
    super(message);
    this.name = "CoveAnalyzeError";
    this.code = code;
  }
}

export interface AnalyzeParams {
  psbt: bitcoin.Psbt;
  view: CoveCanonicalView;
  network: GuardianV3Network;
  /** Protocol fee schedule (bps). Defaults to the development COVE_FEE_CONFIG. */
  buyFeeBps?: bigint;
  /** Flat sats added on top of the percentage. */
  buyFeeFlatSats?: bigint;
  /** Creator share of a mint, bps of the curve price. */
  creatorFeeBps?: bigint;
  redeemFeeBps?: bigint;
  /** Flat sats deducted on top of the percentage. */
  redeemFeeFlatSats?: bigint;
}

function assertAllowedNetwork(_network: GuardianV3Network): void {
  // mainnet is a valid V3 network; the fail-closed guards (MAINNET1 recovery
  // profile + remote signer + no local key) live in validate.ts and the
  // application/service startup, not here.
}

export function analyzeMintTransitionV3(params: AnalyzeParams): MintAnalysis {
  assertAllowedNetwork(params.network);
  const wire = decodeCoveOpReturn(params.psbt); // throws on malformed wire
  if (wire.op !== OP_MINT) {
    throw new CoveAnalyzeError("WRONG_OPCODE", `expected MINT, got op 0x${wire.op.toString(16)}`);
  }
  const tokenId = wire.tokenId;
  const amountAtoms = wire.amount;
  const recipientVout = wire.recipientVout;

  const currentState = params.view.getCurrentBackingState(tokenId);
  if (!currentState) throw new CoveAnalyzeError("UNKNOWN_TOKEN", "token not deployed in view");
  const backingOutpoint = params.view.getBackingOutpoint(tokenId);
  if (!backingOutpoint) throw new CoveAnalyzeError("UNKNOWN_TOKEN", "no canonical backing outpoint");

  const inputs = readPsbtInputs(params.psbt);
  const backingInput = inputs[0];
  if (!backingInput) throw new CoveAnalyzeError("BAD_PSBT", "no inputs");
  if (
    backingInput.outpoint.txid !== backingOutpoint.txid ||
    backingInput.outpoint.vout !== backingOutpoint.vout
  ) {
    throw new CoveAnalyzeError(
      "BACKING_VOUT_MISMATCH",
      `input 0 spends ${backingInput.outpoint.txid}:${backingInput.outpoint.vout}, ` +
        `expected ${backingOutpoint.txid}:${backingOutpoint.vout}`,
    );
  }

  let nextState: CoveStateV2;
  let grossSats: bigint;
  try {
    const canonical = applyMintV2(currentState, amountAtoms);
    nextState = canonical.nextState;
    grossSats = canonical.grossSats;
  } catch (e) {
    throw new CoveAnalyzeError("REFERENCE_POLICY_REJECTED", (e as Error).message);
  }

  const protocolFeeSats = mintFeeSats(grossSats, amountAtoms, params.buyFeeBps ?? COVE_FEE_CONFIG.buyFeeBps, params.buyFeeFlatSats ?? COVE_FEE_CONFIG.buyFeeFlatSats);
  const creatorScript = params.view.getTokenCreatorScript?.(tokenId) ?? null;
  if (!creatorScript) throw new CoveAnalyzeError("CREATOR_UNKNOWN", "the view has no creator for this token");
  const creatorFee = creatorFeeSats(grossSats, params.creatorFeeBps ?? COVE_FEE_CONFIG.creatorFeeBps);
  const outputs = readPsbtOutputs(params.psbt);
  const totalIn = inputs.reduce((s, i) => s + i.valueSats, 0n);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0n);
  const minerFeeSats = totalIn - totalOut;

  return {
    op: "MINT",
    tokenId,
    amountAtoms,
    recipientVout,
    currentState,
    backingOutpoint,
    nextState,
    grossSats,
    protocolFeeSats,
    creatorFeeSats: creatorFee,
    creatorScript,
    minerFeeSats,
    backingInputIndex: 0,
    buyerInputIndices: inputs.slice(1).map((i) => i.index),
  };
}

export function analyzeRedeemTransitionV3(params: AnalyzeParams): RedeemAnalysis {
  assertAllowedNetwork(params.network);
  const wire = decodeCoveOpReturn(params.psbt); // throws on malformed wire
  if (wire.op !== OP_REDEEM) {
    throw new CoveAnalyzeError("WRONG_OPCODE", `expected REDEEM, got op 0x${wire.op.toString(16)}`);
  }
  const tokenId = wire.tokenId;
  const redeemAmountAtoms = wire.redeemAmount;
  const changeAllocations = wire.changeAllocations;

  const currentState = params.view.getCurrentBackingState(tokenId);
  if (!currentState) throw new CoveAnalyzeError("UNKNOWN_TOKEN", "token not deployed in view");
  const backingOutpoint = params.view.getBackingOutpoint(tokenId);
  if (!backingOutpoint) throw new CoveAnalyzeError("UNKNOWN_TOKEN", "no canonical backing outpoint");

  const inputs = readPsbtInputs(params.psbt);
  const backingInput = inputs[0];
  if (!backingInput) throw new CoveAnalyzeError("BAD_PSBT", "no inputs");
  if (
    backingInput.outpoint.txid !== backingOutpoint.txid ||
    backingInput.outpoint.vout !== backingOutpoint.vout
  ) {
    throw new CoveAnalyzeError(
      "BACKING_VOUT_MISMATCH",
      `input 0 spends ${backingInput.outpoint.txid}:${backingInput.outpoint.vout}, ` +
        `expected ${backingOutpoint.txid}:${backingOutpoint.vout}`,
    );
  }

  // Resolve seller token inputs from ACTUAL transaction input outpoints.
  const tokenInputIndices: number[] = [];
  const tokenInputOutpoints: { txid: string; vout: number }[] = [];
  let tokenInputTotalAtoms = 0n;
  for (const input of inputs.slice(1)) {
    const tok = params.view.getTokenUtxo(input.outpoint);
    if (tok) {
      if (!tok.tokenId.equals(tokenId)) {
        throw new CoveAnalyzeError("MIXED_TOKEN_INPUT", `input ${input.index} is a different token`);
      }
      tokenInputIndices.push(input.index);
      tokenInputOutpoints.push(tok.outpoint);
      tokenInputTotalAtoms += tok.amountAtoms;
    }
    // else: ordinary BTC input (fee funding); NOT claimed as a token input.
  }
  if (tokenInputIndices.length === 0) {
    throw new CoveAnalyzeError("FORGED_TOKEN_INPUT", "no canonical token input resolves");
  }

  let nextState: CoveStateV2;
  let grossSats: bigint;
  try {
    const canonical = applyRedeemV2(currentState, redeemAmountAtoms);
    nextState = canonical.nextState;
    grossSats = canonical.grossSats;
  } catch (e) {
    throw new CoveAnalyzeError("REFERENCE_POLICY_REJECTED", (e as Error).message);
  }

  const protocolFeeSats = redeemFeeSats(grossSats, params.redeemFeeBps ?? COVE_FEE_CONFIG.redeemFeeBps, params.redeemFeeFlatSats ?? COVE_FEE_CONFIG.redeemFeeFlatSats);
  const netPayoutSats = grossSats - protocolFeeSats;
  const outputs = readPsbtOutputs(params.psbt);
  const totalIn = inputs.reduce((s, i) => s + i.valueSats, 0n);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0n);
  const minerFeeSats = totalIn - totalOut;

  return {
    op: "REDEEM",
    tokenId,
    redeemAmountAtoms,
    changeAllocations,
    currentState,
    backingOutpoint,
    tokenInputOutpoints,
    tokenInputTotalAtoms,
    nextState,
    grossSats,
    protocolFeeSats,
    netPayoutSats,
    minerFeeSats,
    backingInputIndex: 0,
    tokenInputIndices,
  };
}
