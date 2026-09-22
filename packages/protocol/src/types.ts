import type { Network } from "@crclaunch/config";
import type { Sats, TokenAtoms, TxId } from "@crclaunch/curve";

export type {
  Network,
  ProtocolHealth,
  ProtocolHealthState,
} from "@crclaunch/config";
export type { Sats, TokenAtoms, TxId, BasisPoints } from "@crclaunch/curve";

export type ProtocolOperation =
  | "DEPLOY"
  | "MINT"
  | "TRANSFER"
  | "DEX_ASK"
  | "DEX_BID"
  | "DEX_CANCEL"
  | "GRADUATION";

export type OperationStatus = "VERIFIED" | "UNVERIFIED";

export type ProtocolTxStatus =
  | "UNKNOWN"
  | "MEMPOOL"
  | "CONFIRMED"
  | "REJECTED"
  | "DROPPED";

export interface ProtocolToken {
  deploymentId: TxId;
  ticker: string;
  tickerNormalized: string;
  name: string | null;
  creatorAddress: string;
  network: Network;
  totalSupplyAtoms: TokenAtoms;
  publicSupplyAtoms: TokenAtoms;
  reserveSupplyAtoms: TokenAtoms;
  confirmedMintedAtoms: TokenAtoms;
  pendingMintedAtoms: TokenAtoms;
  currentStage: number;
  deployHeight: bigint | null;
  status: "LIVE" | "SOLD_OUT" | "GRADUATING" | "GRADUATED";
  stateHash: string;
}

export type ProtocolEventType =
  | "DEPLOY"
  | "MINT"
  | "TRANSFER"
  | "DEX_ASK"
  | "DEX_BID"
  | "DEX_CANCEL"
  | "GRADUATION";

export interface ProtocolEvent {
  network: Network;
  blockHeight: bigint;
  blockHash: string;
  txid: TxId;
  eventIndex: number;
  eventType: ProtocolEventType;
  deploymentId: TxId | null;
  walletFrom: string | null;
  walletTo: string | null;
  tokenAmountAtoms: TokenAtoms | null;
  btcAmountSats: Sats | null;
  payload: unknown;
}

export interface ProtocolTransactionStatus {
  txid: TxId;
  status: ProtocolTxStatus;
  confirmations: number;
  blockHeight: bigint | null;
}

/** Kinds of logical transaction outputs for invariant validation + UI. */
export type OutputKind =
  | "curve-reserve"
  | "platform-fee"
  | "protocol-fee"
  | "launch-fee"
  | "token"
  | "buyer"
  | "seller"
  | "change"
  | "unknown";

export interface TransactionOutput {
  index: number;
  address: string | null;
  amountSats: Sats;
  kind: OutputKind;
  tokenAmountAtoms?: TokenAtoms;
}

export interface TransactionInput {
  txid: TxId;
  vout: number;
  address: string | null;
  amountSats: Sats;
}

export interface TransactionSummary {
  operation: ProtocolOperation;
  ticker?: string;
  tokenAmountAtoms?: TokenAtoms;
  curveContributionSats?: Sats;
  platformFeeSats?: Sats;
  protocolFeeSats?: Sats;
  minerFeeSats?: Sats;
  launchFeeSats?: Sats;
  totalSpendSats?: Sats;
  buyerReceivesAtoms?: TokenAtoms;
  sellerReceivesSats?: Sats;
  outputCount: number;
}

/** A transaction built by the protocol adapter, ready for the wallet to sign. */
export interface UnsignedProtocolTransaction {
  operation: ProtocolOperation;
  network: Network;
  /** Raw transaction hex, when a real chain is in use. */
  txHex: string | null;
  /** PSBT (base64) when a real chain is in use. */
  psbtBase64: string | null;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  feeSats: Sats;
  /** State hash the transaction was built against. */
  stateHash: string;
  expiresAtHeight: bigint;
  expiresAtTimestamp: string;
  summary: TransactionSummary;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BuildDeployInput {
  ticker: string;
  name: string;
  creatorAddress: string;
  treasuryAddress: string;
  launchFeeSats: Sats;
  network: Network;
}

export interface BuildMintInput {
  deploymentId: TxId;
  ticker: string;
  buyerAddress: string;
  treasuryAddress: string;
  tokenAmountAtoms: TokenAtoms;
  curveContributionSats: Sats;
  platformFeeSats: Sats;
  minerFeeSats: Sats;
  currentSupplyAtoms: TokenAtoms;
  stateHash: string;
}

export interface BuildSellInput {
  deploymentId: TxId;
  sellerAddress: string;
  tokenAmountAtoms: TokenAtoms;
  askingPriceSats: Sats;
  expiryHeight: bigint;
}

export interface BuildBuyInput {
  deploymentId: TxId;
  listingId: string;
  buyerAddress: string;
  tokenAmountAtoms: TokenAtoms;
  totalPriceSats: Sats;
  sellerAddress: string;
  protocolFeeSats: Sats;
  platformFeeSats: Sats;
  minerFeeSats: Sats;
  treasuryAddress: string;
}

export interface BuildCancelInput {
  deploymentId: TxId;
  listingId: string;
  sellerAddress: string;
}

export interface DecodedProtocolTransaction {
  operation: ProtocolOperation;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  ticker?: string;
  tokenAmountAtoms?: TokenAtoms;
}

export interface VerificationStatus {
  deploy: OperationStatus;
  mint: OperationStatus;
  transfer: OperationStatus;
  dexAsk: OperationStatus;
  dexBid: OperationStatus;
  cancel: OperationStatus;
  graduation: OperationStatus;
}

export interface ProtocolListing {
  id: string;
  deploymentId: string;
  sellerAddress: string;
  tokenAmountAtoms: TokenAtoms;
  askingPriceSats: Sats;
  creationHeight: bigint;
  expiryHeight: bigint;
  status: "OPEN" | "TAKEN" | "CANCELLED" | "EXPIRED";
}

export interface FeeBreakdown {
  protocolFeeSats: Sats;
  platformFeeSats: Sats;
  sellerReceivesSats: Sats;
  minerFeeSats: Sats;
  buyerPaysSats: Sats;
}
