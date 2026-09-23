import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { parseCanonicalOpReturn } from "@crclaunch/bitcoin";
import {
  applyCoveOperation,
  computeStateRoot,
  createCoveState,
  decodeCoveEnvelope,
  isCoveMagic,
  toCoveTransaction,
  validateCoveOperation,
} from "@crclaunch/protocol";
import type { CoveConfig, CoveState } from "@crclaunch/protocol";

export type CoveTxClassification =
  | "NON_COVE"
  | "MALFORMED_COVE"
  | "VALID"
  | "INVALID"
  | "MULTIPLE_COVE_OPERATIONS";

export interface CoveIndexEvent {
  blockHeight: number;
  txIndex: number;
  txid: string;
  operation: string | null;
  classification: CoveTxClassification;
  valid: boolean;
  reason: string | null;
}

export interface ProcessTxResult {
  classification: CoveTxClassification;
  operation?: string;
  valid?: boolean;
  reason?: string | null;
}

export interface CoveIndexStats {
  processedBlocks: number;
  processedTxs: number;
  coveCandidateTxs: number;
  validOps: number;
  invalidOps: number;
  tokens: number;
  reserveSats: bigint;
  treasurySats: bigint;
  stateRoot: string;
}

/**
 * Deterministic Cove indexer (pure state fold). Performs no network/DB I/O and
 * holds no keys; prevouts must be resolved by the caller. Block/tx order is
 * the ONLY ordering input (height ASC, txIndex ASC).
 */
export class CoveIndexer {
  private state: CoveState;
  private events: CoveIndexEvent[] = [];
  private processedBlocks = 0;
  private processedTxs = 0;
  private coveCandidateTxs = 0;
  private validOps = 0;
  private invalidOps = 0;

  constructor(private readonly config: CoveConfig) {
    this.state = createCoveState();
  }

  processBlock(height: number, txs: BitcoinProtocolTx[]): void {
    this.processedBlocks += 1;
    for (let i = 0; i < txs.length; i++) {
      this.processTx(height, i, txs[i]!);
    }
  }

  processTx(height: number, txIndex: number, btcTx: BitcoinProtocolTx): ProcessTxResult {
    this.processedTxs += 1;

    // Scan every output for a canonical OP_RETURN whose payload carries Cove
    // magic. A Cove envelope may exist ONLY at vout 0 (single-envelope rule).
    const coveOutputs: { index: number; payload: Uint8Array }[] = [];
    for (const out of btcTx.outputs) {
      if (out.scriptPubKeyHex === "6a") continue; // bare OP_RETURN, no data
      const payload = parseCanonicalOpReturn(Buffer.from(out.scriptPubKeyHex, "hex"));
      if (payload && isCoveMagic(payload)) {
        coveOutputs.push({ index: out.index, payload });
      }
    }

    if (coveOutputs.length === 0) return { classification: "NON_COVE" };
    this.coveCandidateTxs += 1;

    if (coveOutputs.length > 1) {
      this.invalidOps += 1;
      this.record(height, txIndex, btcTx.txid, null, "MULTIPLE_COVE_OPERATIONS", false, "MULTIPLE_COVE_OPERATIONS");
      return { classification: "MULTIPLE_COVE_OPERATIONS", valid: false, reason: "MULTIPLE_COVE_OPERATIONS" };
    }

    const coveOut = coveOutputs[0]!;
    if (coveOut.index !== 0) {
      this.invalidOps += 1;
      this.record(height, txIndex, btcTx.txid, null, "INVALID", false, "WRONG_VOUT");
      return { classification: "INVALID", valid: false, reason: "WRONG_VOUT" };
    }

    const decoded = decodeCoveEnvelope(coveOut.payload);
    if (!decoded.ok) {
      this.invalidOps += 1;
      this.record(height, txIndex, btcTx.txid, null, "MALFORMED_COVE", false, decoded.reason ?? "MALFORMED_COVE");
      return { classification: "MALFORMED_COVE", valid: false, reason: decoded.reason };
    }

    const mapped = toCoveTransaction(btcTx, decoded.envelope!, txIndex);
    if (!mapped.ok) {
      this.invalidOps += 1;
      this.record(height, txIndex, btcTx.txid, decoded.envelope!.op, "INVALID", false, mapped.reason);
      return { classification: "INVALID", operation: decoded.envelope!.op, valid: false, reason: mapped.reason };
    }

    const result = validateCoveOperation(this.state, mapped.tx, this.config);
    if (result.valid) {
      applyCoveOperation(this.state, mapped.tx, this.config);
      this.validOps += 1;
    } else {
      this.invalidOps += 1;
    }
    this.record(height, txIndex, btcTx.txid, mapped.tx.operation, result.valid ? "VALID" : "INVALID", result.valid, result.reason);
    return {
      classification: result.valid ? "VALID" : "INVALID",
      operation: mapped.tx.operation,
      valid: result.valid,
      reason: result.reason,
    };
  }

  private record(
    height: number,
    txIndex: number,
    txid: string,
    op: string | null,
    classification: CoveTxClassification,
    valid: boolean,
    reason: string | null,
  ): void {
    this.events.push({ blockHeight: height, txIndex, txid, operation: op, classification, valid, reason });
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
      coveCandidateTxs: this.coveCandidateTxs,
      validOps: this.validOps,
      invalidOps: this.invalidOps,
      tokens: this.state.tokens.size,
      reserveSats: this.state.reserveSats,
      treasurySats: this.state.platformTreasurySats,
      stateRoot: this.getStateRoot(),
    };
  }
}
