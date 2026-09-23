import type { Sats, TokenAtoms } from "@crclaunch/curve";

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
 * parser. Protocol logic consumes only this shape, never provider-specific
 * JSON. Token amounts are WHOLE tokens (the canonical curve unit).
 */
export interface CoveTransaction {
  protocol: "cove";
  version: 1;
  operation: CoveOperationKind;
  txid: string;
  /** Owner derived from input 0's spent UTXO scriptPubKey. */
  actor: ProtocolOwnerId;
  /** Recipient derived from vout 1 (mint/transfer). */
  recipient?: ProtocolOwnerId;
  /** Ticker reference (DEPLOY, and the unique deployment key for MINT/TRANSFER). */
  ticker?: string;
  tokenAmount?: TokenAtoms;
  supplyBefore?: TokenAtoms;
  protocolOutputs: CoveProtocolOutput[];
}

export interface CoveToken {
  deploymentId: string;
  ticker: string;
  creator: ProtocolOwnerId;
  confirmedSupply: TokenAtoms;
  publicSupply: TokenAtoms;
  currentStage: number;
}

export interface CoveBalance {
  available: TokenAtoms;
  locked: TokenAtoms;
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
