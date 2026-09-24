import * as bitcoin from "bitcoinjs-lib";
import {
  TOKEN_CARRIER_SATS,
  applyMintV2,
  applyRedeemV2,
  type CoveStateV2,
} from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import { executeMintV3, executeRedeemV3 } from "@crclaunch/cove-simplicity";
import { OP_MINT, OP_REDEEM, OP_TRANSFER } from "@crclaunch/cove-wire";
import { COVE_FEE_CONFIG, deterministicFee } from "@crclaunch/cove-economics";
import { RESERVE_ANCHOR_SATS } from "./builder.js";
import { decodeCoveOpReturnTx } from "./resolve.js";
import { buildCanonicalMintWitness, buildCanonicalRedeemWitness } from "./witness.js";
import type { CoveCanonicalView, GuardianV3Network } from "./types.js";

/**
 * Finalized-transaction revalidation (§14). These consume FINAL RAW TX BYTES
 * (never a mutable PSBT) and re-run the transaction-level invariants from
 * scratch. The broadcast boundary is the last security boundary: builder-valid
 * and Guardian-signed are not sufficient; the serialized bytes must be valid.
 *
 * Note: the exact miner-fee total depends on non-Cove BTC prevout values that
 * are only known at sign time (the PSBT carries witnessUtxo). The sign-time
 * validator bounds the miner fee; Core enforces the actual fee at consensus.
 * These revalidators therefore re-check every OUTPUT-side, wire, state,
 * Simplicity, and reference invariant that a post-signature tamper could alter.
 */

export interface FinalizeParams {
  rawTxHex: string;
  view: CoveCanonicalView;
  network: GuardianV3Network;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  feeScript: Buffer;
}

export interface FinalizeResult {
  ok: boolean;
  reason?: string;
}

function btcNetwork(network: GuardianV3Network): bitcoin.networks.Network {
  switch (network) {
    case "regtest":
      return bitcoin.networks.regtest;
    case "testnet":
    case "signet":
      return bitcoin.networks.testnet;
    default:
      throw new Error(`bad network ${String(network)}`);
  }
}

function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

export function validateFinalizedMintTransaction(params: FinalizeParams): FinalizeResult {
  let tx: bitcoin.Transaction;
  try {
    tx = bitcoin.Transaction.fromHex(params.rawTxHex);
  } catch (e) {
    return { ok: false, reason: `BAD_TX: ${(e as Error).message}` };
  }

  let wire;
  try {
    wire = decodeCoveOpReturnTx(tx);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (wire.op !== OP_MINT) return { ok: false, reason: "WRONG_OPCODE" };
  const tokenId = wire.tokenId;

  const currentState = params.view.getCurrentBackingState(tokenId);
  if (!currentState) return { ok: false, reason: "UNKNOWN_TOKEN" };
  const backingOutpoint = params.view.getBackingOutpoint(tokenId);
  if (!backingOutpoint) return { ok: false, reason: "UNKNOWN_TOKEN" };

  // input 0 must be the canonical backing outpoint
  const ins0 = tx.ins[0];
  if (!ins0) return { ok: false, reason: "BAD_TX" };
  const ins0Txid = Buffer.from(ins0.hash).reverse().toString("hex");
  if (ins0Txid !== backingOutpoint.txid || ins0.index !== backingOutpoint.vout) {
    return { ok: false, reason: "BACKING_VOUT_MISMATCH" };
  }

  let nextState: CoveStateV2;
  let grossSats: bigint;
  try {
    const canonical = applyMintV2(currentState, wire.amount);
    nextState = canonical.nextState;
    grossSats = canonical.grossSats;
  } catch (e) {
    return { ok: false, reason: `REFERENCE_POLICY_REJECTED: ${(e as Error).message}` };
  }
  const protocolFeeSats = deterministicFee(grossSats, COVE_FEE_CONFIG.buyFeeBps);

  // outputs
  const nextVault = buildBackingVaultV3({
    state: nextState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
    network: btcNetwork(params.network),
  });
  const successor = tx.outs[1];
  if (!successor || !successor.script.equals(nextVault.scriptPubKey)) {
    return { ok: false, reason: "SUCCESSOR_SCRIPT_MISMATCH" };
  }
  const expectedSuccessor = RESERVE_ANCHOR_SATS + nextState.backingSats;
  if (BigInt(successor.value) !== expectedSuccessor) {
    return { ok: false, reason: "SUCCESSOR_VALUE_MISMATCH" };
  }
  if (wire.recipientVout !== 2) return { ok: false, reason: "CARRIER_MISSING" };
  const carrier = tx.outs[2];
  if (!carrier || BigInt(carrier.value) !== TOKEN_CARRIER_SATS) {
    return { ok: false, reason: "CARRIER_VALUE_MISMATCH" };
  }
  const feeOut = tx.outs[3];
  if (!feeOut || BigInt(feeOut.value) !== protocolFeeSats || !feeOut.script.equals(params.feeScript)) {
    return { ok: false, reason: "FEE_MISMATCH" };
  }
  if (tx.outs.length > 5) return { ok: false, reason: "UNEXPECTED_OUTPUT" };

  // Simplicity + reference
  const w = buildCanonicalMintWitness({
    prevState: currentState,
    nextState,
    amountAtoms: wire.amount,
    canonicalGrossSats: grossSats,
  });
  if (!w.ok) return { ok: false, reason: "WITNESS_CONSTRUCTION_FAILED" };
  const sim = executeMintV3(w.witness);
  if (sim.result !== "PASS") return { ok: false, reason: sim.failure ?? "SIMPLICITY_REJECTED" };

  return { ok: true };
}

export function validateFinalizedRedeemTransaction(params: FinalizeParams): FinalizeResult {
  let tx: bitcoin.Transaction;
  try {
    tx = bitcoin.Transaction.fromHex(params.rawTxHex);
  } catch (e) {
    return { ok: false, reason: `BAD_TX: ${(e as Error).message}` };
  }

  let wire;
  try {
    wire = decodeCoveOpReturnTx(tx);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (wire.op !== OP_REDEEM) return { ok: false, reason: "WRONG_OPCODE" };
  const tokenId = wire.tokenId;

  const currentState = params.view.getCurrentBackingState(tokenId);
  if (!currentState) return { ok: false, reason: "UNKNOWN_TOKEN" };
  const backingOutpoint = params.view.getBackingOutpoint(tokenId);
  if (!backingOutpoint) return { ok: false, reason: "UNKNOWN_TOKEN" };

  const ins0 = tx.ins[0];
  if (!ins0) return { ok: false, reason: "BAD_TX" };
  const ins0Txid = Buffer.from(ins0.hash).reverse().toString("hex");
  if (ins0Txid !== backingOutpoint.txid || ins0.index !== backingOutpoint.vout) {
    return { ok: false, reason: "BACKING_VOUT_MISMATCH" };
  }

  // resolve seller token inputs
  let tokenInputTotalAtoms = 0n;
  for (let i = 1; i < tx.ins.length; i++) {
    const ins = tx.ins[i]!;
    const txid = Buffer.from(ins.hash).reverse().toString("hex");
    const tok = params.view.getTokenUtxo({ txid, vout: ins.index });
    if (tok) {
      if (!tok.tokenId.equals(tokenId)) return { ok: false, reason: "MIXED_TOKEN_INPUT" };
      tokenInputTotalAtoms += tok.amountAtoms;
    }
  }
  if (tokenInputTotalAtoms === 0n) return { ok: false, reason: "FORGED_TOKEN_INPUT" };

  const changeAtoms = tokenInputTotalAtoms - wire.redeemAmount;
  if (changeAtoms < 0n) return { ok: false, reason: "TOKEN_OWNERSHIP_INSUFFICIENT" };
  const wireChangeSum = wire.changeAllocations.reduce((s, a) => s + a.amount, 0n);
  if (wireChangeSum !== changeAtoms) return { ok: false, reason: "TOKEN_CHANGE_MISMATCH" };

  let nextState: CoveStateV2;
  let grossSats: bigint;
  try {
    const canonical = applyRedeemV2(currentState, wire.redeemAmount);
    nextState = canonical.nextState;
    grossSats = canonical.grossSats;
  } catch (e) {
    return { ok: false, reason: `REFERENCE_POLICY_REJECTED: ${(e as Error).message}` };
  }
  const protocolFeeSats = deterministicFee(grossSats, COVE_FEE_CONFIG.redeemFeeBps);
  const netPayoutSats = grossSats - protocolFeeSats;

  const nextVault = buildBackingVaultV3({
    state: nextState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
    network: btcNetwork(params.network),
  });
  const successor = tx.outs[1];
  if (!successor || !successor.script.equals(nextVault.scriptPubKey)) {
    return { ok: false, reason: "SUCCESSOR_SCRIPT_MISMATCH" };
  }
  const expectedSuccessor = RESERVE_ANCHOR_SATS + nextState.backingSats;
  if (BigInt(successor.value) !== expectedSuccessor) {
    return { ok: false, reason: "SUCCESSOR_VALUE_MISMATCH" };
  }
  const payout = tx.outs[2];
  if (!payout || BigInt(payout.value) !== netPayoutSats) {
    return { ok: false, reason: "PAYOUT_MISMATCH" };
  }
  const feeOut = tx.outs[3];
  if (!feeOut || BigInt(feeOut.value) !== protocolFeeSats || !feeOut.script.equals(params.feeScript)) {
    return { ok: false, reason: "FEE_MISMATCH" };
  }

  if (changeAtoms > 0n) {
    const changeOut = tx.outs[4];
    if (!changeOut || BigInt(changeOut.value) !== TOKEN_CARRIER_SATS) {
      return { ok: false, reason: "TOKEN_CHANGE_MISMATCH" };
    }
  } else if (tx.outs.length > 4) {
    return { ok: false, reason: "UNEXPECTED_OUTPUT" };
  }

  const w = buildCanonicalRedeemWitness({
    prevState: currentState,
    nextState,
    amountAtoms: wire.redeemAmount,
    canonicalGrossSats: grossSats,
  });
  if (!w.ok) return { ok: false, reason: "WITNESS_CONSTRUCTION_FAILED" };
  const sim = executeRedeemV3(w.witness);
  if (sim.result !== "PASS") return { ok: false, reason: sim.failure ?? "SIMPLICITY_REJECTED" };

  return { ok: true };
}

export function validateFinalizedTransferTransaction(params: {
  rawTxHex: string;
  view: CoveCanonicalView;
}): FinalizeResult {
  let tx: bitcoin.Transaction;
  try {
    tx = bitcoin.Transaction.fromHex(params.rawTxHex);
  } catch (e) {
    return { ok: false, reason: `BAD_TX: ${(e as Error).message}` };
  }
  let wire;
  try {
    wire = decodeCoveOpReturnTx(tx);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (wire.op !== OP_TRANSFER) return { ok: false, reason: "WRONG_OPCODE" };
  const tokenId = wire.tokenId;

  // Sum actual token inputs from the canonical view.
  let tokenIn = 0n;
  for (const ins of tx.ins) {
    const txid = Buffer.from(ins.hash).reverse().toString("hex");
    const tok = params.view.getTokenUtxo({ txid, vout: ins.index });
    if (tok) {
      if (!tok.tokenId.equals(tokenId)) return { ok: false, reason: "MIXED_TOKEN_INPUT" };
      tokenIn += tok.amountAtoms;
    }
  }
  const allocSum = wire.allocations.reduce((s, a) => s + a.amount, 0n);
  if (allocSum !== tokenIn) {
    return { ok: false, reason: `TOKEN_CONSERVATION: in=${tokenIn} out=${allocSum}` };
  }
  return { ok: true };
}

// Re-exported for tests.
export { outpointKey };
