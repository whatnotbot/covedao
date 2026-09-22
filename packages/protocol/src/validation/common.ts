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
