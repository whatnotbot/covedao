import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import {
  applyCoveOperation,
  computeStateRoot,
  createCoveState,
  parseCoveEnvelope,
  toCoveTransaction,
  validateCoveOperation,
} from "@crclaunch/protocol";
import type { CoveConfig, CoveState } from "@crclaunch/protocol";

export interface CoveIndexEvent {
  blockHeight: number;
  txid: string;
  /** DEPLOY | MINT | TRANSFER, or null when the tx is not a Cove tx. */
  operation: string | null;
  valid: boolean | null;
  reason: string | null;
}

export interface ProcessTxResult {
  isCove: boolean;
  operation?: string;
  valid?: boolean;
  reason?: string | null;
}

export interface CoveIndexStats {
  processedBlocks: number;
  processedTxs: number;
  coveTxs: number;
  validOps: number;
  invalidOps: number;
  tokens: number;
  reserveSats: bigint;
  treasurySats: bigint;
  stateRoot: string;
}

/**
 * Deterministic Cove indexer. State is a pure function of the ordered stream
 * of decoded Bitcoin transactions (the event log). The indexer performs no
 * network I/O and holds no keys; prevouts must be resolved by the caller
 * (the CLI resolves them from a full node).
 */
export class CoveIndexer {
  private state: CoveState;
  private events: CoveIndexEvent[] = [];
  private processedBlocks = 0;
  private processedTxs = 0;
  private coveTxs = 0;
  private validOps = 0;
  private invalidOps = 0;

  constructor(private readonly config: CoveConfig) {
    this.state = createCoveState();
  }

  /** Process a whole block's transactions in canonical order. */
  processBlock(height: number, txs: BitcoinProtocolTx[]): void {
    this.processedBlocks += 1;
    for (const tx of txs) {
      this.processTx(height, tx);
    }
  }

  /** Process one decoded transaction (prevout for input 0 must be resolved). */
  processTx(height: number, btcTx: BitcoinProtocolTx): ProcessTxResult {
    this.processedTxs += 1;

    // The Cove envelope lives in vout 0 as an OP_RETURN.
    const envOut = btcTx.outputs[0];
    if (!envOut?.opReturnData) {
      return { isCove: false };
    }
    this.coveTxs += 1;

    const parsed = parseCoveEnvelope(envOut.opReturnData);
    if (!parsed.ok) {
      this.recordInvalid(height, btcTx.txid, null, parsed.reason ?? "PARSE_ERROR");
      return { isCove: true, valid: false, reason: parsed.reason };
    }

    const mapped = toCoveTransaction(btcTx, parsed.envelope!);
    if (!mapped.ok) {
      this.recordInvalid(height, btcTx.txid, parsed.envelope!.op, mapped.reason);
      return { isCove: true, operation: parsed.envelope!.op, valid: false, reason: mapped.reason };
    }

    const result = validateCoveOperation(this.state, mapped.tx, this.config);
    if (result.valid) {
      applyCoveOperation(this.state, mapped.tx, this.config);
      this.validOps += 1;
    } else {
      this.invalidOps += 1;
    }
    this.events.push({
      blockHeight: height,
      txid: btcTx.txid,
      operation: mapped.tx.operation,
      valid: result.valid,
      reason: result.reason,
    });
    return {
      isCove: true,
      operation: mapped.tx.operation,
      valid: result.valid,
      reason: result.reason,
    };
  }

  private recordInvalid(height: number, txid: string, op: string | null, reason: string): void {
    this.invalidOps += 1;
    this.events.push({ blockHeight: height, txid, operation: op, valid: false, reason });
  }

  getState(): CoveState {
    return this.state;
  }

  getStateRoot(): string {
    return computeStateRoot(this.state);
  }

  getEvents(): readonly CoveIndexEvent[] {
    return this.events;
  }

  getStats(): CoveIndexStats {
    return {
      processedBlocks: this.processedBlocks,
      processedTxs: this.processedTxs,
      coveTxs: this.coveTxs,
      validOps: this.validOps,
      invalidOps: this.invalidOps,
      tokens: this.state.tokens.size,
      reserveSats: this.state.reserveSats,
      treasurySats: this.state.platformTreasurySats,
      stateRoot: this.getStateRoot(),
    };
  }
}
