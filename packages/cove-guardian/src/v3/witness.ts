import type { CoveStateV2 } from "@crclaunch/cove-covenant";
import {
  buildMintSimplicityWitness,
  buildRedeemSimplicityWitness,
  type MintWitness,
  type RedeemWitness,
} from "@crclaunch/cove-simplicity";

/**
 * Canonical Simplicity witness construction for the Guardian (§5/§6). Values
 * are derived ONLY from the canonical previous state + the canonical V2
 * transition; the cove-simplicity constructors recompute and cross-check
 * `nextState`/`canonicalGrossSats`, so caller-supplied values can never be
 * injected. A construction failure maps to a typed refusal, never a signature.
 */

export interface WitnessOk<T> {
  ok: true;
  witness: T;
}
export interface WitnessErr {
  ok: false;
  detail: string;
}
export type WitnessResult<T> = WitnessOk<T> | WitnessErr;

export function buildCanonicalMintWitness(params: {
  prevState: CoveStateV2;
  nextState: CoveStateV2;
  amountAtoms: bigint;
  canonicalGrossSats: bigint;
}): WitnessResult<MintWitness> {
  try {
    return { ok: true, witness: buildMintSimplicityWitness(params) };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export function buildCanonicalRedeemWitness(params: {
  prevState: CoveStateV2;
  nextState: CoveStateV2;
  amountAtoms: bigint;
  canonicalGrossSats: bigint;
}): WitnessResult<RedeemWitness> {
  try {
    return { ok: true, witness: buildRedeemSimplicityWitness(params) };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
