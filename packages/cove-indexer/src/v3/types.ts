import type { CoveStateV2, OutPoint } from "@crclaunch/cove-covenant";
import type { VaultRecoveryProfile } from "@crclaunch/cove-vault";

/**
 * Canonical V3 indexer state types (§6). The authoritative derived state
 * mirrors CoveChainView semantics; balances are NEVER stored as authority —
 * they are derived from the unspent token-UTXO set.
 */

export interface V3TokenMeta {
  tokenId: string; // 64-hex
  ticker: string;
  policyVersion: number;
  tokenNonce: string; // hex
  deployTxid: string;
  deployHeight: bigint;
  deployBlockHash: string;
}

export interface V3Backing {
  tokenId: string;
  state: CoveStateV2;
  stateHash: string;
  outpoint: OutPoint;
  scriptPubKey: string; // hex
  btcValue: bigint;
  updatedTxid: string;
  updatedHeight: bigint;
  updatedBlockHash: string;
}

export interface V3TokenUtxo {
  txid: string;
  vout: number;
  tokenId: string;
  amountAtoms: bigint;
  scriptPubKey: string; // hex
  createdHeight: bigint;
  createdBlockHash: string;
}

export type V3Operation = "DEPLOY" | "MINT" | "TRANSFER" | "REDEEM";

export interface V3Event {
  txid: string;
  blockHeight: bigint;
  blockHash: string;
  txIndex: number;
  operation: V3Operation | null;
  valid: boolean;
  reason: string | null;
  tokenId: string | null;
}

export interface V3Cursor {
  network: string;
  height: bigint;
  blockHash: string;
  stateRoot: string;
}

export interface V3BlockInput {
  height: bigint;
  hash: string;
  parentHash: string;
  /** transactions in index order (raw hex). */
  txs: string[];
}

export interface V3IndexerConfig {
  network: "regtest" | "signet" | "testnet" | "mainnet";
  chainIdentity: string;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  /** MAINNET1 threshold-recovery profile (optional; DEV1 derived from recoveryKeyXOnly when absent). */
  recoveryProfile?: VaultRecoveryProfile;
  feeScript: Buffer;
  /** Absolute activation height; Cove ops below this are ignored (§13/§48). */
  genesisHeight: bigint;
  /** Protocol fee schedule (bps). Defaults to the development COVE_FEE_CONFIG. */
  buyFeeBps?: bigint;
  /** Flat sats added to every backing buy, on top of the percentage. */
  buyFeeFlatSatsAtTopStage?: bigint;
  redeemFeeBps?: bigint;
  /** Flat sats deducted from every redemption, on top of the percentage. */
  redeemFeeFlatSats?: bigint;
}

export interface BlockUndo {
  height: bigint;
  blockHash: string;
  /** inverse ops applied in reverse order to roll the block back. */
  ops: UndoOp[];
}

export type UndoOp =
  | { kind: "DEPLOY"; tokenId: string }
  | { kind: "MINT"; tokenId: string; priorBacking: V3Backing; createdUtxo: V3TokenUtxo }
  | {
      kind: "REDEEM";
      tokenId: string;
      /** the actual txid that spent the seller token UTXOs (full REDEEM creates none). */
      spendingTxid: string;
      priorBacking: V3Backing;
      spentUtxos: V3TokenUtxo[];
      createdUtxos: V3TokenUtxo[];
    }
  | {
      kind: "TRANSFER";
      /** the actual txid that spent the input token UTXOs. */
      spendingTxid: string;
      spentUtxos: V3TokenUtxo[];
      createdUtxos: V3TokenUtxo[];
    };
