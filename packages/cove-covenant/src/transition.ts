import {
  ATOMS_PER_TOKEN,
  PUBLIC_SUPPLY_ATOMS,
  getStageForSupply,
  quoteExactTokens,
} from "@crclaunch/curve";
import type { Atoms, Sats } from "@crclaunch/curve";
import type { CoveState } from "./types.js";

export class CovenantError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CovenantError";
    this.code = code;
  }
}

export function isCovenantError(e: unknown): e is CovenantError {
  return e instanceof CovenantError;
}

export interface MintResult {
  nextState: CoveState;
  curveContributionSats: Sats;
}

/**
 * Pure, deterministic S0 → S1 MINT transition. Recomputes the bonding-curve
 * contribution from the canonical curve (never trusts a caller-supplied amount)
 * and produces the successor state. Rejects zero/sub-token/over-supply mints.
 */
export function applyMint(prev: CoveState, amountAtoms: Atoms): MintResult {
  if (amountAtoms <= 0n) {
    throw new CovenantError("ZERO_MINT", "Minted amount must be positive.");
  }
  if (amountAtoms % ATOMS_PER_TOKEN !== 0n) {
    throw new CovenantError("SUBTOKEN_MINT", "Minted amount must be a whole display token.");
  }
  const amountTokens = amountAtoms / ATOMS_PER_TOKEN;
  const supplyTokens = prev.publicSupplyAtoms / ATOMS_PER_TOKEN;
  const nextSupplyAtoms = prev.publicSupplyAtoms + amountAtoms;
  if (nextSupplyAtoms > PUBLIC_SUPPLY_ATOMS) {
    throw new CovenantError(
      "OVERMINT",
      `Mint would exceed public supply (${nextSupplyAtoms} > ${PUBLIC_SUPPLY_ATOMS}).`,
    );
  }

  const quote = quoteExactTokens({ desiredTokens: amountTokens, currentSupply: supplyTokens });
  const curveContributionSats = quote.curveContributionSats;

  return {
    curveContributionSats,
    nextState: {
      ...prev,
      publicSupplyAtoms: nextSupplyAtoms,
      reserveSats: prev.reserveSats + curveContributionSats,
      curveStage: getStageForSupply(nextSupplyAtoms / ATOMS_PER_TOKEN),
    },
  };
}

/**
 * Whether a proposed successor state is EXACTLY the result of `applyMint` for
 * the given previous state + amount. Used by the Guardian policy to refuse a
 * manipulated successor state.
 */
export function isCorrectMintSuccessor(
  prev: CoveState,
  amountAtoms: Atoms,
  proposed: CoveState,
): boolean {
  try {
    const { nextState } = applyMint(prev, amountAtoms);
    return serializeCoveStateEq(nextState, proposed);
  } catch {
    return false;
  }
}

function serializeCoveStateEq(a: CoveState, b: CoveState): boolean {
  return (
    a.version === b.version &&
    a.tokenId === b.tokenId &&
    a.phase === b.phase &&
    a.publicSupplyAtoms === b.publicSupplyAtoms &&
    a.reserveSats === b.reserveSats &&
    a.curveStage === b.curveStage
  );
}
