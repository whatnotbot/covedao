import type { TokenAllocation } from "@crclaunch/cove-wire";

/**
 * Token-UTXO ownership model (§3). Cove ownership derives from Bitcoin UTXOs:
 * a token allocation is attached to an actual transaction output, and the owner
 * transfers those Cove tokens by spending that Bitcoin output. The indexer may
 * aggregate balances, but the authoritative derived state is the set of unspent
 * Cove token outputs. No database-only ownership, no account balance changeable
 * without consuming a Bitcoin UTXO.
 */

export interface TokenInput {
  /** Bitcoin outpoint string (txid:vout). */
  outpoint: string;
  /** Cove token amount carried by this input (atoms). */
  amountAtoms: bigint;
}

export interface TxOutputView {
  script: Buffer;
  value: number;
}

export interface TokenTransferValidation {
  ok: boolean;
  reason?: string;
  /** Reconstructed token change total (inputs − allocated outputs). */
  changeAtoms?: bigint;
}

function isOpReturn(script: Buffer): boolean {
  return script.length > 0 && script[0] === 0x6a;
}

/**
 * Validate a token-UTXO transfer for ONE tokenId (MVP: single tokenId per tx).
 *
 * Invariants:
 *   - inputs are non-empty
 *   - every allocation references an existing, non-OP_RETURN output
 *   - no duplicate allocation vout
 *   - token conservation: sum(inputs) == sum(output allocations)
 *   - no inflation, no accidental burn
 */
export function validateTokenTransfer(params: {
  tokenId: Buffer;
  tokenInputs: TokenInput[];
  allocations: TokenAllocation[];
  outputs: TxOutputView[];
}): TokenTransferValidation {
  const { tokenInputs, allocations, outputs } = params;

  if (tokenInputs.length === 0) {
    return { ok: false, reason: "NO_TOKEN_INPUT" };
  }
  let inputTotal = 0n;
  for (const input of tokenInputs) {
    if (input.amountAtoms <= 0n) return { ok: false, reason: "INVALID_INPUT_AMOUNT" };
    inputTotal += input.amountAtoms;
  }
  if (allocations.length === 0) {
    return { ok: false, reason: "ZERO_ALLOCATIONS" };
  }

  const seen = new Set<number>();
  let outputTotal = 0n;
  for (const alloc of allocations) {
    if (alloc.amount <= 0n) return { ok: false, reason: "ZERO_AMOUNT" };
    if (alloc.vout >= outputs.length) return { ok: false, reason: "ALLOCATION_VOUT_OUT_OF_RANGE" };
    if (isOpReturn(outputs[alloc.vout]!.script))
      return { ok: false, reason: "ALLOCATION_TO_OP_RETURN" };
    if (seen.has(alloc.vout)) return { ok: false, reason: "DUPLICATE_VOUT" };
    seen.add(alloc.vout);
    outputTotal += alloc.amount;
    if (outputTotal > 0xffffffffffffffffn) return { ok: false, reason: "AMOUNT_OVERFLOW" };
  }

  if (outputTotal > inputTotal) return { ok: false, reason: "INFLATION" };
  // Exact conservation (no silent burn) for TRANSFER.
  if (outputTotal !== inputTotal) return { ok: false, reason: "BURN_OR_INCONSISTENT_CHANGE" };

  return { ok: true, changeAtoms: 0n };
}

/**
 * Validate REDEEM token accounting: inputs may exceed the redeemed amount, with
 * the surplus represented by `changeAllocations`.
 */
export function validateRedeemTokenAccounting(params: {
  tokenInputs: TokenInput[];
  redeemAmountAtoms: bigint;
  changeAllocations: TokenAllocation[];
  outputs: TxOutputView[];
}): TokenTransferValidation {
  const { tokenInputs, redeemAmountAtoms, changeAllocations, outputs } = params;

  if (tokenInputs.length === 0) return { ok: false, reason: "NO_TOKEN_INPUT" };
  let inputTotal = 0n;
  for (const input of tokenInputs) {
    if (input.amountAtoms <= 0n) return { ok: false, reason: "INVALID_INPUT_AMOUNT" };
    inputTotal += input.amountAtoms;
  }
  if (redeemAmountAtoms <= 0n) return { ok: false, reason: "ZERO_AMOUNT" };
  if (redeemAmountAtoms > inputTotal) return { ok: false, reason: "REDEEM_EXCEEDS_OWNERSHIP" };

  const seen = new Set<number>();
  let changeTotal = 0n;
  for (const alloc of changeAllocations) {
    if (alloc.amount <= 0n) return { ok: false, reason: "ZERO_AMOUNT" };
    if (alloc.vout >= outputs.length) return { ok: false, reason: "ALLOCATION_VOUT_OUT_OF_RANGE" };
    if (isOpReturn(outputs[alloc.vout]!.script))
      return { ok: false, reason: "ALLOCATION_TO_OP_RETURN" };
    if (seen.has(alloc.vout)) return { ok: false, reason: "DUPLICATE_VOUT" };
    seen.add(alloc.vout);
    changeTotal += alloc.amount;
  }

  // redeemed + change must equal inputs (no burn, no inflation).
  if (redeemAmountAtoms + changeTotal !== inputTotal) {
    return { ok: false, reason: "BURN_OR_INCONSISTENT_CHANGE" };
  }
  return { ok: true, changeAtoms: changeTotal };
}
