import * as bitcoin from "bitcoinjs-lib";
import { applyMint, stateOutputScript, type CoveState } from "@crclaunch/cove-covenant";
import { PRIMARY_MINT_FEE_BPS, computePlatformFee } from "@crclaunch/curve";
import type { Atoms, Sats } from "@crclaunch/curve";
import {
  GuardianError,
  MAX_FEE_SATS,
  isWellFormedCommitment,
  validateStateInvariants,
  type GuardianDecision,
  type GuardianNetwork,
} from "./policy.js";

/**
 * Transaction-layer covenant policy. This is where the Guardian policy is bound
 * to the ACTUAL Bitcoin spend: the inputs/outputs/amounts/fee of a proposed
 * PSBT are verified against the canonical transition, not merely against a
 * caller-supplied summary.
 *
 * Reserve model (Phase 1.5): the covenant state UTXO physically carries the
 * curve reserve plus a fixed non-reserve anchor:
 *
 *   stateUtxo.value = state.reserveSats + RESERVE_ANCHOR_SATS
 *
 * so that the anchor cancels across a transition:
 *
 *   successor.value = previous.value + canonicalCurveContributionSats
 *
 * `state.reserveSats` therefore corresponds to the actual locked reserve BTC,
 * not merely an accounting number.
 */

/** Fixed non-reserve satoshi anchor carried by every covenant state UTXO. */
export const RESERVE_ANCHOR_SATS = 10_000n;

/** Value (dust) of the recipient/token-commitment output. */
export const TOKEN_COMMITMENT_SATS = 1_000n;

export interface MintIntent {
  /** The authoritative previous covenant state the Guardian is spending. */
  prevState: CoveState;
  /** Tokens being minted, in atoms (a whole number of display tokens). */
  amountAtoms: Atoms;
  /** Token recipient commitment: a P2TR (0x5120‖32B) or P2WPKH (0x0014‖20B). */
  recipientCommitment: Buffer;
  /** Platform-fee destination: a P2TR or P2WPKH script. */
  platformFeeScript: Buffer;
}

export interface MintTxAnalysis {
  /** Index of the single covenant state input. */
  stateInputIndex: number;
  /** The canonical successor state (recomputed, never trusted). */
  nextState: CoveState;
  curveContributionSats: Sats;
  platformFeeSats: Sats;
  minerFeeSats: Sats;
  /** Sum of buyer funding input values. */
  buyerInputSats: Sats;
  buyerChangeSats: Sats;
}

function toSats(v: number | bigint): Sats {
  return BigInt(v);
}

function u64Check(v: Sats, label: string): void {
  if (v < 0n || v > 0xffffffffffffffffn) {
    throw new GuardianError("AMOUNT_OVERFLOW", `${label} out of u64 range`);
  }
}

/** Resolve an input's prevout script + value from witnessUtxo or nonWitnessUtxo. */
function inputScriptAndValue(
  psbt: bitcoin.Psbt,
  index: number,
): { script: Buffer; valueSats: Sats } {
  const input = psbt.data.inputs[index];
  if (!input) throw new GuardianError("INPUT_MISSING", `input #${index} missing`);
  if (input.witnessUtxo) {
    return {
      script: Buffer.from(input.witnessUtxo.script),
      valueSats: toSats(input.witnessUtxo.value),
    };
  }
  if (input.nonWitnessUtxo) {
    const vout = psbt.txInputs[index]!.index;
    const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
    const out = prevTx.outs[vout];
    if (!out) throw new GuardianError("INPUT_MISSING", `input #${index} prevout missing`);
    return { script: Buffer.from(out.script), valueSats: toSats(out.value) };
  }
  throw new GuardianError("INPUT_MISSING", `input #${index} has no prevout data`);
}

/** Resolve every input's prevout script + value (witnessUtxo or nonWitnessUtxo). */
export function resolveAllInputs(psbt: bitcoin.Psbt): { script: Buffer; valueSats: Sats }[] {
  const out: { script: Buffer; valueSats: Sats }[] = [];
  for (let i = 0; i < psbt.inputCount; i++) {
    out.push(inputScriptAndValue(psbt, i));
  }
  return out;
}

/** Reconstruct the unsigned transaction from a PSBT (for BIP341 sighash). */
export function unsignedTransaction(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  tx.version = psbt.version;
  tx.locktime = psbt.locktime;
  for (const input of psbt.txInputs) {
    tx.ins.push({
      hash: Buffer.from(input.hash),
      index: input.index,
      script: Buffer.alloc(0),
      sequence: input.sequence ?? 0xffffffff,
      witness: [],
    });
  }
  for (const output of psbt.txOutputs) {
    tx.outs.push({ script: Buffer.from(output.script), value: output.value });
  }
  return tx;
}

function bitcoinNetworkFor(network: GuardianNetwork): bitcoin.networks.Network {
  switch (network) {
    case "mainnet":
      return bitcoin.networks.bitcoin;
    case "signet":
      return bitcoin.networks.testnet; // signet shares the testnet bech32/params in bitcoinjs
    case "regtest":
      return bitcoin.networks.regtest;
    case "testnet":
      return bitcoin.networks.testnet;
  }
}

/**
 * Verify a proposed MINT PSBT end-to-end against the canonical transition.
 * `internalKey` is the covenant internal key P; the Guardian recomputes
 * Q(prevState) and Q(nextState) from it and never trusts the PSBT's claims.
 */
export function validateMintTx(
  psbt: bitcoin.Psbt,
  internalKey: Buffer,
  intent: MintIntent,
  network: GuardianNetwork = "regtest",
): GuardianDecision {
  const { prevState, amountAtoms, recipientCommitment, platformFeeScript } = intent;

  // Network gate (mainnet is never activated; cross-network PSBTs are refused).
  if (network === "mainnet") {
    return { ok: false, reason: "MAINNET_NOT_ACTIVATED" };
  }
  const expectedNet = bitcoinNetworkFor(network);
  const psbtNet = (psbt as unknown as { opts: { network: bitcoin.networks.Network } }).opts.network;
  if (
    psbtNet.bech32 !== expectedNet.bech32 ||
    psbtNet.pubKeyHash !== expectedNet.pubKeyHash ||
    psbtNet.scriptHash !== expectedNet.scriptHash
  ) {
    return { ok: false, reason: "WRONG_NETWORK" };
  }

  // State invariants + MINT phase gate (PUBLIC_MINT only).
  const inv = validateStateInvariants(prevState, "MINT");
  if (!inv.ok) return inv;

  // Recompute the canonical transition (never trust a caller-provided nextState).
  let canonical;
  try {
    canonical = applyMint(prevState, amountAtoms);
  } catch {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }
  const nextState = canonical.nextState;
  const curveContributionSats = canonical.curveContributionSats;
  const platformFeeSats = computePlatformFee(curveContributionSats, PRIMARY_MINT_FEE_BPS);

  // Intents must themselves be well-formed commitments.
  if (!isWellFormedCommitment(recipientCommitment)) {
    return { ok: false, reason: "RECIPIENT_MALFORMED" };
  }
  if (platformFeeSats > 0n && !isWellFormedCommitment(platformFeeScript)) {
    return { ok: false, reason: "PLATFORM_FEE_MALFORMED" };
  }

  // Locate the single covenant state input by recomputing Q(prevState).
  const stateScript = stateOutputScript(prevState, internalKey, expectedNet);
  const stateIndices: number[] = [];
  const resolved: { script: Buffer; valueSats: Sats }[] = [];
  for (let i = 0; i < psbt.inputCount; i++) {
    const r = inputScriptAndValue(psbt, i);
    resolved.push(r);
    if (r.script.equals(stateScript)) stateIndices.push(i);
  }
  if (stateIndices.length === 0) {
    return { ok: false, reason: "STATE_INPUT_NOT_FOUND" };
  }
  if (stateIndices.length > 1) {
    return { ok: false, reason: "MULTIPLE_STATE_INPUTS" };
  }
  const stateInputIndex = stateIndices[0]!;

  // Previous state UTXO must physically carry reserve + anchor.
  const expectedPrevValue = prevState.reserveSats + RESERVE_ANCHOR_SATS;
  const prevValue = resolved[stateInputIndex]!.valueSats;
  if (prevValue !== expectedPrevValue) {
    return { ok: false, reason: "STATE_INPUT_WRONG_VALUE" };
  }

  // Buyer funding must exist and be separate from the state input.
  const buyerInputSats = resolved.reduce<Sats>(
    (sum, r, i) => (i === stateInputIndex ? sum : sum + r.valueSats),
    0n,
  );
  if (buyerInputSats <= 0n) {
    return { ok: false, reason: "NO_BUYER_INPUT" };
  }

  // Canonical output layout:
  //   0: successor state UTXO (Q(nextState))
  //   1: recipient/token commitment
  //   2: platform fee (present iff platformFeeSats > 0)
  //   3: buyer change (present iff change > 0)
  const outs = psbt.txOutputs;
  if (outs.length < 2) {
    return { ok: false, reason: "OUTPUT_LAYOUT_INCOMPLETE" };
  }

  // Output 0: successor state UTXO.
  const successorScript = stateOutputScript(nextState, internalKey, expectedNet);
  if (!outs[0]!.script.equals(successorScript)) {
    return { ok: false, reason: "SUCCESSOR_SCRIPT_MISMATCH" };
  }
  const expectedSuccessorValue = prevValue + curveContributionSats;
  const successorValue = toSats(outs[0]!.value);
  if (successorValue !== expectedSuccessorValue) {
    return { ok: false, reason: "RESERVE_CONTRIBUTION_MISMATCH" };
  }

  // Output 1: recipient/token commitment.
  const recipientValue = toSats(outs[1]!.value);
  if (!outs[1]!.script.equals(recipientCommitment) || recipientValue !== TOKEN_COMMITMENT_SATS) {
    return { ok: false, reason: "RECIPIENT_OUTPUT_MISMATCH" };
  }

  // Outputs 2+: platform fee (optional) then buyer change (optional), canonical order.
  let cursor = 2;
  let platValue = 0n;
  if (platformFeeSats > 0n) {
    const out = outs[cursor];
    if (!out) return { ok: false, reason: "OUTPUT_LAYOUT_INCOMPLETE" };
    if (!out.script.equals(platformFeeScript) || toSats(out.value) !== platformFeeSats) {
      return { ok: false, reason: "PLATFORM_FEE_MISMATCH" };
    }
    platValue = platformFeeSats;
    cursor++;
  }
  const changeOut = outs[cursor];
  let changeValue = 0n;
  if (changeOut) {
    // Change is the buyer's own remainder; its script is not constrained.
    changeValue = toSats(changeOut.value);
    cursor++;
  }

  // Reject any output beyond the canonical layout (extra unauthorized output)
  // or a reordered layout (a trailing output where change/platform were expected).
  if (cursor !== outs.length) {
    return { ok: false, reason: "EXTRA_UNAUTHORIZED_OUTPUT" };
  }

  // Miner fee = total in − total out.
  const totalIn = prevValue + buyerInputSats;
  const totalOut = successorValue + recipientValue + platValue + changeValue;
  const minerFeeSats = totalIn - totalOut;
  if (minerFeeSats < 0n || minerFeeSats > MAX_FEE_SATS) {
    return { ok: false, reason: "FEE_OUT_OF_RANGE" };
  }

  // Curve payment: buyer's net spend must equal the canonical contribution +
  // recipient dust + platform fee + miner fee. This catches wrong change and
  // wrong curve payment.
  const expectedChange =
    buyerInputSats - curveContributionSats - TOKEN_COMMITMENT_SATS - platValue - minerFeeSats;
  if (changeValue !== expectedChange) {
    return { ok: false, reason: "CURVE_PAYMENT_MISMATCH" };
  }

  u64Check(minerFeeSats, "minerFeeSats");
  u64Check(totalIn, "totalIn");
  u64Check(totalOut, "totalOut");

  return { ok: true };
}

/**
 * Compute an analysis record from a (structurally-valid) MINT PSBT without
 * policy validation. Used by the builder (which must be able to construct a
 * transaction for a caller-supplied intent before the Guardian judges it).
 */
export function computeMintAnalysis(
  psbt: bitcoin.Psbt,
  internalKey: Buffer,
  intent: MintIntent,
  network: GuardianNetwork = "regtest",
): MintTxAnalysis {
  const { prevState, amountAtoms } = intent;
  const canonical = applyMint(prevState, amountAtoms);
  const curveContributionSats = canonical.curveContributionSats;
  const platformFeeSats = computePlatformFee(curveContributionSats, PRIMARY_MINT_FEE_BPS);

  const stateScript = stateOutputScript(prevState, internalKey, bitcoinNetworkFor(network));
  let stateInputIndex = -1;
  let prevValue = 0n;
  let buyerInputSats = 0n;
  const resolved: { script: Buffer; valueSats: Sats }[] = [];
  for (let i = 0; i < psbt.inputCount; i++) {
    const r = inputScriptAndValue(psbt, i);
    resolved.push(r);
    if (r.script.equals(stateScript)) {
      stateInputIndex = i;
      prevValue = r.valueSats;
    }
  }
  buyerInputSats = resolved.reduce<Sats>(
    (sum, r, i) => (i === stateInputIndex ? sum : sum + r.valueSats),
    0n,
  );

  const outs = psbt.txOutputs;
  const successorValue = toSats(outs[0]!.value);
  const recipientValue = toSats(outs[1]!.value);
  let platValue = 0n;
  let changeValue = 0n;
  let cursor = 2;
  if (platformFeeSats > 0n) {
    platValue = toSats(outs[cursor]!.value);
    cursor++;
  }
  if (outs[cursor]) {
    changeValue = toSats(outs[cursor]!.value);
  }
  const totalIn = prevValue + buyerInputSats;
  const totalOut = successorValue + recipientValue + platValue + changeValue;

  return {
    stateInputIndex,
    nextState: canonical.nextState,
    curveContributionSats,
    platformFeeSats,
    minerFeeSats: totalIn - totalOut,
    buyerInputSats,
    buyerChangeSats: changeValue,
  };
}

/**
 * Validate a MINT PSBT, then compute its analysis. Throws GuardianError
 * (POLICY_REJECTED) on an invalid transaction.
 */
export function analyzeMintTx(
  psbt: bitcoin.Psbt,
  internalKey: Buffer,
  intent: MintIntent,
  network: GuardianNetwork = "regtest",
): MintTxAnalysis {
  const decision = validateMintTx(psbt, internalKey, intent, network);
  if (!decision.ok) {
    throw new GuardianError("POLICY_REJECTED", decision.reason ?? "rejected");
  }
  return computeMintAnalysis(psbt, internalKey, intent, network);
}

export interface ResolvedInput {
  txid: string;
  vout: number;
  script: Buffer;
  valueSats: Sats;
}

export interface BuildMintPsbtParams {
  internalKey: Buffer;
  intent: MintIntent;
  /** The covenant state input (previous state UTXO). */
  stateInput: ResolvedInput;
  /** Buyer funding inputs (signed separately by the buyer). */
  buyerInputs: ResolvedInput[];
  /** Buyer change output script (buyer's own address). */
  buyerChangeScript: Buffer;
  minerFeeSats: Sats;
  network: GuardianNetwork;
}

/**
 * Build a canonical MINT PSBT (unsigned) from resolved prevouts. Deterministic:
 * input 0 is the state UTXO, followed by buyer inputs; outputs are ordered
 * [successor state, recipient, platform fee?, buyer change?].
 */
export function buildMintPsbt(params: BuildMintPsbtParams): {
  psbt: bitcoin.Psbt;
  analysis: MintTxAnalysis;
} {
  const { internalKey, intent, stateInput, buyerInputs, buyerChangeScript, minerFeeSats, network } =
    params;
  const { prevState, amountAtoms, recipientCommitment, platformFeeScript } = intent;

  const canonical = applyMint(prevState, amountAtoms);
  const nextState = canonical.nextState;
  const curveContributionSats = canonical.curveContributionSats;
  const platformFeeSats = computePlatformFee(curveContributionSats, PRIMARY_MINT_FEE_BPS);

  const net = bitcoinNetworkFor(network);
  const psbt = new bitcoin.Psbt({ network: net });

  // Input 0: covenant state UTXO. (tapInternalKey/tapMerkleRoot are added by
  // the Guardian at signing time, NOT trusted from the proposer.)
  psbt.addInput({
    hash: stateInput.txid,
    index: stateInput.vout,
    witnessUtxo: { script: stateInput.script, value: Number(stateInput.valueSats) },
  });

  // Buyer funding inputs.
  for (const b of buyerInputs) {
    psbt.addInput({
      hash: b.txid,
      index: b.vout,
      witnessUtxo: { script: b.script, value: Number(b.valueSats) },
    });
  }

  // Outputs in canonical order.
  const successorValue = stateInput.valueSats + curveContributionSats;
  psbt.addOutput({
    script: stateOutputScript(nextState, internalKey, net),
    value: Number(successorValue),
  });
  psbt.addOutput({ script: recipientCommitment, value: Number(TOKEN_COMMITMENT_SATS) });
  if (platformFeeSats > 0n) {
    psbt.addOutput({ script: platformFeeScript, value: Number(platformFeeSats) });
  }
  const totalBuyerIn = buyerInputs.reduce<Sats>((s, b) => s + b.valueSats, 0n);
  const changeValue =
    totalBuyerIn - curveContributionSats - TOKEN_COMMITMENT_SATS - platformFeeSats - minerFeeSats;
  if (changeValue < 0n) {
    throw new GuardianError("INSUFFICIENT_FUNDS", "buyer inputs do not cover the mint");
  }
  if (changeValue > 0n) {
    psbt.addOutput({ script: buyerChangeScript, value: Number(changeValue) });
  }

  const analysis = computeMintAnalysis(psbt, internalKey, intent, network);
  return { psbt, analysis };
}
