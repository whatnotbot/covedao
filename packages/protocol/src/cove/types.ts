import type { Atoms, Sats } from "@crclaunch/curve";

/** Canonical protocol identity: hex scriptPubKey (what Bitcoin commits to). */
export type ProtocolOwnerId = string;

export type CoveOperationKind = "DEPLOY" | "MINT" | "TRANSFER";

export interface CoveProtocolOutput {
  index: number;
  scriptPubKeyHex: string;
  amountSats: Sats;
  role: string;
}

/**
 * Normalized Cove transaction produced by the Bitcoin decoder + envelope
 * parser + mapper. Protocol logic consumes only this shape, never
 * provider-specific JSON. Token amounts are ATOMS (8 decimals).
 */
export interface CoveTransaction {
  operation: CoveOperationKind;
  txid: string;
  /** Transaction index within its block (consensus ordering). */
  txIndex: number;
  /** Owner derived from input 0's spent UTXO scriptPubKey. */
  actor: ProtocolOwnerId;
  /** Recipient derived from vout 1 (mint/transfer). */
  recipient?: ProtocolOwnerId;
  ticker?: string;
  amountAtoms?: Atoms;
  supplyBeforeAtoms?: Atoms;
  protocolOutputs: CoveProtocolOutput[];
}

export interface CoveToken {
  deploymentId: string;
  ticker: string;
  creator: ProtocolOwnerId;
  confirmedSupplyAtoms: Atoms;
  publicSupplyAtoms: Atoms;
  currentStage: number;
}

/**
 * A holder's total token balance. `availableAtoms` is the TOTAL owned (V1 has
 * no locked/reserved subset — that is a future V2 listing concern, not present
 * in the consensus state).
 */
export interface CoveBalance {
  availableAtoms: Atoms;
}

export interface CoveState {
  tokens: Map<string, CoveToken>;
  tickerIndex: Map<string, string>;
  balances: Map<ProtocolOwnerId, Map<string, CoveBalance>>;
  reserveSats: Sats;
  platformTreasurySats: Sats;
}

export interface CoveValidationResult {
  valid: boolean;
  reason: string | null;
}

export function createCoveState(): CoveState {
  return {
    tokens: new Map(),
    tickerIndex: new Map(),
    balances: new Map(),
    reserveSats: 0n,
    platformTreasurySats: 0n,
  };
}
