import {
  COVE_STATE_VERSION,
  applyMint,
  deserializeState,
  serializeState,
  stateHash,
  type CoveState,
} from "@crclaunch/cove-covenant";
import { ATOMS_PER_TOKEN, PUBLIC_SUPPLY_ATOMS, getStageForSupply } from "@crclaunch/curve";
import type { Atoms, Sats } from "@crclaunch/curve";

/**
 * Guardian policy engine — INDEPENDENT of key custody and of any caller-supplied
 * amounts. It re-derives the canonical transition from the committed previous
 * state and refuses anything that does not match. This is the layer that must
 * run inside isolated custody (Nitro Enclave / KMS) before the signing key is
 * ever touched.
 */

export class GuardianError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GuardianError";
    this.code = code;
  }
}

export type GuardianNetwork = "mainnet" | "signet" | "regtest" | "testnet";

export interface MintContext {
  prevState: CoveState;
  nextState: CoveState;
  amountAtoms: Atoms;
  /** The bonding-curve BTC payment the transaction claims to move into reserve. */
  curveContributionSats: Sats;
  /** Miner fee. */
  feeSats: Sats;
  /** Token recipient commitment (P2TR output key or P2WPKH script). */
  recipientCommitment: Buffer;
  network: GuardianNetwork;
}

export interface GuardianDecision {
  ok: boolean;
  reason?: string;
}

export const MAX_FEE_SATS = 50_000n;

/** A commitment is a well-formed P2TR (34 bytes) or P2WPKH (22 bytes). */
export function isWellFormedCommitment(script: Buffer): boolean {
  const hex = script.toString("hex");
  return /^5120[0-9a-f]{64}$/.test(hex) || /^0014[0-9a-f]{40}$/.test(hex);
}

/**
 * State invariants that hold for ANY valid Cove state, independent of the
 * transition that produced it. `operation === "MINT"` additionally requires the
 * PUBLIC_MINT phase (a MINT is only legal before graduation).
 */
export function validateStateInvariants(state: CoveState, operation?: "MINT"): GuardianDecision {
  // Version + token identity.
  if (state.version !== COVE_STATE_VERSION) {
    return { ok: false, reason: "INVALID_STATE_VERSION" };
  }
  if (!/^[0-9a-f]{64}$/.test(state.tokenId)) {
    return { ok: false, reason: "INVALID_TOKEN_ID" };
  }
  if (/^0{64}$/.test(state.tokenId)) {
    return { ok: false, reason: "INVALID_TOKEN_ID" };
  }

  // Supply: non-negative, within the public cap, and atomically canonical
  // (a whole number of display tokens — no sub-token supply).
  if (state.publicSupplyAtoms < 0n || state.publicSupplyAtoms > PUBLIC_SUPPLY_ATOMS) {
    return { ok: false, reason: "SUPPLY_OUT_OF_RANGE" };
  }
  if (state.publicSupplyAtoms % ATOMS_PER_TOKEN !== 0n) {
    return { ok: false, reason: "SUPPLY_NOT_ATOMIC" };
  }

  // curveStage is EXACTLY the stage implied by the committed supply.
  let impliedStage: number;
  try {
    impliedStage = getStageForSupply(state.publicSupplyAtoms / ATOMS_PER_TOKEN);
  } catch {
    return { ok: false, reason: "SUPPLY_OUT_OF_RANGE" };
  }
  if (state.curveStage !== impliedStage) {
    return { ok: false, reason: "CURVE_STAGE_MISMATCH" };
  }

  // Reserve consistency: the state's reserve is non-negative. (The binding to
  // the physically-locked UTXO value is enforced at the transaction layer.)
  if (state.reserveSats < 0n) {
    return { ok: false, reason: "RESERVE_NEGATIVE" };
  }

  if (operation === "MINT" && state.phase !== "PUBLIC_MINT") {
    return { ok: false, reason: "PHASE_NOT_PUBLIC_MINT" };
  }

  return { ok: true };
}

function consistentState(s: CoveState): boolean {
  try {
    return serializeState(deserializeState(serializeState(s))).length > 0;
  } catch {
    return false;
  }
}

/**
 * Verify a single MINT transition (S0 → S1) against the canonical curve and the
 * committed previous state. Returns ok only when every invariant holds.
 */
export function validateMint(ctx: MintContext): GuardianDecision {
  const {
    prevState,
    nextState,
    amountAtoms,
    curveContributionSats,
    feeSats,
    recipientCommitment,
    network,
  } = ctx;

  // Correct previous state (round-trips its canonical encoding).
  if (!consistentState(prevState)) {
    return { ok: false, reason: "PREV_STATE_MALFORMED" };
  }
  if (!consistentState(nextState)) {
    return { ok: false, reason: "NEXT_STATE_MALFORMED" };
  }
  if (prevState.tokenId !== nextState.tokenId) {
    return { ok: false, reason: "TOKEN_ID_MISMATCH" };
  }

  // Amount.
  if (amountAtoms <= 0n) {
    return { ok: false, reason: "ZERO_AMOUNT" };
  }
  if (amountAtoms % ATOMS_PER_TOKEN !== 0n) {
    return { ok: false, reason: "SUBTOKEN_AMOUNT" };
  }

  // Supply conservation + no overmint.
  if (nextState.publicSupplyAtoms !== prevState.publicSupplyAtoms + amountAtoms) {
    return { ok: false, reason: "SUPPLY_CONSERVATION" };
  }
  if (nextState.publicSupplyAtoms > PUBLIC_SUPPLY_ATOMS) {
    return { ok: false, reason: "OVERMINT" };
  }

  // Bonding-curve payment: re-derived, never trusted from the caller.
  let canonical;
  try {
    canonical = applyMint(prevState, amountAtoms);
  } catch {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }
  if (curveContributionSats !== canonical.curveContributionSats) {
    return { ok: false, reason: "PAYMENT_MISMATCH" };
  }

  // Reserve movement: the curve contribution must move into reserve.
  if (nextState.reserveSats !== prevState.reserveSats + curveContributionSats) {
    return { ok: false, reason: "RESERVE_MOVEMENT" };
  }

  // Successor state commitment: must be exactly the canonical successor.
  if (stateHash(nextState) !== stateHash(canonical.nextState)) {
    return { ok: false, reason: "SUCCESSOR_STATE_MISMATCH" };
  }

  // Recipient commitment.
  if (!isWellFormedCommitment(recipientCommitment)) {
    return { ok: false, reason: "RECIPIENT_MALFORMED" };
  }

  // Fee cap.
  if (feeSats < 0n || feeSats > MAX_FEE_SATS) {
    return { ok: false, reason: "FEE_OUT_OF_RANGE" };
  }

  // Network: refuse mainnet until owner activation (Guardian is never mainnet
  // without an explicit, separately-gated deployment).
  if (network === "mainnet") {
    return { ok: false, reason: "MAINNET_NOT_ACTIVATED" };
  }

  return { ok: true };
}
