import type { Network } from "@crclaunch/config";
import type { Sats, TokenAtoms } from "@crclaunch/curve";
import type {
  ProtocolEventType,
  ProtocolOperation,
  TransactionInput,
  TransactionOutput,
} from "../types.js";

export type MockTxStatus = "MEMPOOL" | "CONFIRMED" | "REJECTED";

export interface MockTxPayload {
  ticker?: string;
  name?: string;
  creatorAddress?: string;
  treasuryAddress?: string;
  deploymentId?: string;
  listingId?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  tokenAmountAtoms?: TokenAtoms;
  curveContributionSats?: Sats;
  platformFeeSats?: Sats;
  protocolFeeSats?: Sats;
  minerFeeSats?: Sats;
  launchFeeSats?: Sats;
  askingPriceSats?: Sats;
  totalPriceSats?: Sats;
  expiryHeight?: bigint;
  supplyBeforeAtoms?: TokenAtoms;
}

export interface MockTxEnvelope {
  v: 1;
  op: ProtocolOperation;
  txid: string;
  network: Network;
  signer: string | null;
  signature: string | null;
  payload: MockTxPayload;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  feeSats: Sats;
  stateHash: string;
  expiresAtHeight: bigint;
  expiresAtTimestamp: string;
}

export interface MockTx extends MockTxEnvelope {
  status: MockTxStatus;
  confirmHeight: bigint | null;
  rejectReason: string | null;
}

export interface MockBlock {
  height: bigint;
  hash: string;
  parentHash: string;
  txids: string[];
}

export interface MockToken {
  deploymentId: string;
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
  deployHeight: bigint;
  status: "LIVE" | "SOLD_OUT" | "GRADUATING" | "GRADUATED";
  reserveSats: Sats;
  lastTradePricePerMillion: Sats | null;
}

export interface MockListing {
  id: string;
  deploymentId: string;
  sellerAddress: string;
  tokenAmountAtoms: TokenAtoms;
  askingPriceSats: Sats;
  creationHeight: bigint;
  expiryHeight: bigint;
  status: "OPEN" | "TAKEN" | "CANCELLED" | "EXPIRED";
}

export interface MockEvent {
  network: Network;
  blockHeight: bigint;
  blockHash: string;
  txid: string;
  eventIndex: number;
  eventType: ProtocolEventType;
  deploymentId: string | null;
  walletFrom: string | null;
  walletTo: string | null;
  tokenAmountAtoms: TokenAtoms | null;
  btcAmountSats: Sats | null;
  payload: unknown;
  canonical: boolean;
}

export interface WalletBalance {
  btcSats: Sats;
  tokens: Record<string, TokenAtoms>;
  /** tokens locked in open listings (not spendable). */
  lockedTokens: Record<string, TokenAtoms>;
}

export interface MockChainState {
  network: Network;
  height: bigint;
  blocks: MockBlock[];
  mempool: string[];
  txs: Record<string, MockTx>;
  tokens: Record<string, MockToken>;
  tickerIndex: Record<string, string>;
  balances: Record<string, WalletBalance>;
  listings: Record<string, MockListing>;
  events: Record<string, MockEvent>;
  /** Fees earned by the platform treasury address. */
  platformTreasurySats: Sats;
  /** Protocol-mandated trading fees, tracked separately. */
  protocolTreasurySats: Sats;
}
