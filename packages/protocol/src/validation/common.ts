import type { Sats } from "@crclaunch/curve";
import type { TransactionOutput } from "../types.js";

/**
 * Output helpers shared by the deterministic validators. The validator derives
 * actual payments from transaction OUTPUTS (address + amount), never from
 * payload fields.
 */

export function outputsToAddress(outputs: readonly TransactionOutput[], address: string): Sats {
  return outputs
    .filter((o) => o.address === address)
    .reduce((acc, o) => acc + o.amountSats, 0n);
}

export function countOutputsToAddress(outputs: readonly TransactionOutput[], address: string): number {
  return outputs.filter((o) => o.address === address).length;
}

export function sumOutputsByKind(outputs: readonly TransactionOutput[], kind: string): Sats {
  return outputs.filter((o) => o.kind === kind).reduce((acc, o) => acc + o.amountSats, 0n);
}

export function findOutputByKind(
  outputs: readonly TransactionOutput[],
  kind: string,
): TransactionOutput | undefined {
  return outputs.find((o) => o.kind === kind);
}

/** Count outputs of a given kind (used to detect duplicated mandatory outputs). */
export function countOutputsByKind(outputs: readonly TransactionOutput[], kind: string): number {
  return outputs.filter((o) => o.kind === kind).length;
}

export interface ExpectedOutput {
  index: number;
  address: string;
  amountSats: Sats;
  kind: string;
}

/**
 * Validate the EXACT protocol output layout: output count, index/order,
 * address, amount (exact equality — no overpay/underpay), and kind.
 * Returns a deterministic reason string, or null when valid.
 */
export function validateExactOutputs(
  outputs: readonly TransactionOutput[],
  expected: readonly ExpectedOutput[],
): string | null {
  if (outputs.length !== expected.length) {
    return "INVALID_OUTPUT_LAYOUT";
  }
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]!;
    const out = outputs[i]!;
    if (out.index !== exp.index) return "INVALID_OUTPUT_LAYOUT";
    if (out.address !== exp.address) return "WRONG_OUTPUT_ADDRESS";
    if (out.kind !== exp.kind) return "WRONG_OUTPUT_KIND";
    if (out.amountSats < exp.amountSats) return "UNDERPAYMENT";
    if (out.amountSats > exp.amountSats) return "OVERPAYMENT";
  }
  return null;
}

export interface OpValidationResult<T = unknown> {
  valid: boolean;
  reason: string | null;
  /** Server/protocol-derived values used to apply the transition (never raw payload). */
  normalized: T | null;
}

export function ok<T>(normalized: T): OpValidationResult<T> {
  return { valid: true, reason: null, normalized };
}

export function invalid<T>(reason: string): OpValidationResult<T> {
  return { valid: false, reason, normalized: null };
}
