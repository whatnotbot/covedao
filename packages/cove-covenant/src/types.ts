import type { Atoms, Sats } from "@crclaunch/curve";

/**
 * Cove covenant lifecycle phase, committed into the state and therefore into
 * the Taproot output key. Only forward transitions between phases are valid.
 */
export type CovePhase = "PUBLIC_MINT" | "GRADUATED" | "LIQUIDITY";

export const PHASE_PUBLIC_MINT = 0x00;
export const PHASE_GRADUATED = 0x01;
export const PHASE_LIQUIDITY = 0x02;

/**
 * The canonical, fixed-width Cove covenant state. This is the state that a
 * Taproot UTXO commits to. It is NOT the legacy OP_RETURN/indexer balance model.
 *
 * Fixed-width serialization (big-endian), 51 bytes:
 *   version            u8   (1 byte)
 *   tokenId            32 bytes
 *   phase              u8   (1 byte)
 *   publicSupplyAtoms  u64  (8 bytes)
 *   reserveSats        u64  (8 bytes)
 *   curveStage         u8   (1 byte)
 */
export interface CoveState {
  version: number;
  tokenId: string; // 64-hex (32 bytes)
  phase: CovePhase;
  publicSupplyAtoms: Atoms;
  reserveSats: Sats;
  curveStage: number; // 1..20
}

/** A covenant transition: from a committed previous state to a successor state. */
export type CoveOperation = "MINT" | "GRADUATE" | "BUY" | "SELL" | "TRANSFER";

export interface CoveTransition {
  operation: CoveOperation;
  prevState: CoveState;
  nextState: CoveState;
}

export function phaseToByte(phase: CovePhase): number {
  switch (phase) {
    case "PUBLIC_MINT":
      return PHASE_PUBLIC_MINT;
    case "GRADUATED":
      return PHASE_GRADUATED;
    case "LIQUIDITY":
      return PHASE_LIQUIDITY;
  }
}

export function byteToPhase(b: number): CovePhase {
  switch (b) {
    case PHASE_PUBLIC_MINT:
      return "PUBLIC_MINT";
    case PHASE_GRADUATED:
      return "GRADUATED";
    case PHASE_LIQUIDITY:
      return "LIQUIDITY";
    default:
      throw new Error(`Unknown Cove phase byte ${b}`);
  }
}
