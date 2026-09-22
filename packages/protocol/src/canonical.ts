import type { Sats, TokenAtoms } from "@crclaunch/curve";

/**
 * Higher-level canonical CRC integration contract.
 *
 * The low-level CRCProtocolAdapter models "how to build/decode a Bitcoin
 * transaction". CanonicalCRCProvider models "how the canonical CRC
 * Oracle/indexer authorizes and settles operations". It is the seam that lets
 * the application run against:
 *   - MockCanonicalCRCProvider       (demo)
 *   - UnavailableCanonicalCRCProvider (read-only mainnet, no integration)
 *   - GardenCanonicalCRCProvider     (future, provided by the CRC team)
 */

export interface CRCCapabilities {
  arbitraryDeploy: boolean;
  progressiveMint: boolean;
  customSupply: boolean;
  oracleAuthorization: boolean;
  canonicalBalanceQuery: boolean;
  transfer: boolean;
  marketplace: boolean;
  graduation: boolean;
  vault: boolean;
}

export interface TickerValidation {
  ticker: string;
  valid: boolean;
  reason?: string;
}

export interface DeploymentAuthorizationRequest {
  ticker: string;
  name: string;
  profile?: string;
  creatorAddress: string;
}

export interface DeploymentAuthorization {
  authorized: boolean;
  deploymentId?: string;
  expiresAt?: string;
  reason?: string;
}

export interface DeploymentRules {
  profile: string;
  maxSupplyAtoms: TokenAtoms;
  decimals: number;
  /** basis points of supply reserved for progressive public issuance (0..10000) */
  publicBps: number;
  reserveBps: number;
  stageCount: number;
  priceTableSatsPerMillion: readonly Sats[];
  creatorPremineAtoms: TokenAtoms;
}

export interface MintRules {
  deploymentId: string;
  profile: string;
  stageCount: number;
  priceTableSatsPerMillion: readonly Sats[];
  remainingPublicSupplyAtoms: TokenAtoms;
  minimumContributionSats: Sats;
}

export interface MintAuthorizationRequest {
  deploymentId: string;
  walletAddress: string;
  requestedAmountAtoms: TokenAtoms;
}

export interface MintAuthorization {
  authorized: boolean;
  requiredPaymentSats: Sats;
  tokenAmountAtoms: TokenAtoms;
  startingStage: number;
  endingStage: number;
  supplyBeforeAtoms: TokenAtoms;
  supplyAfterAtoms: TokenAtoms;
  authorizationId?: string;
  expiresAt?: string;
  reason?: string;
}

export type CanonicalOperationKind =
  | "deploy"
  | "mint"
  | "transfer"
  | "list"
  | "buy"
  | "cancel";

export interface SignedCRCOperation {
  operation: CanonicalOperationKind;
  walletAddress: string;
  signedTransactionHex: string;
  deploymentId?: string;
  ticker?: string;
  authorizationId?: string;
}

export interface CRCSubmissionResult {
  operationId: string;
  status: "submitted" | "accepted" | "rejected";
  reason?: string;
}

export interface CRCOperationStatus {
  operationId: string;
  status: "pending" | "accepted" | "rejected" | "finalized";
  txid?: string;
  blockHeight?: bigint;
  reason?: string;
}

export interface CanonicalTokenState {
  deploymentId: string;
  ticker: string;
  status: string;
  totalSupplyAtoms: TokenAtoms;
  confirmedMintedAtoms: TokenAtoms;
  remainingPublicSupplyAtoms: TokenAtoms;
  currentStage: number;
  reserveSats: Sats;
  stateHash: string;
}

export interface CanonicalActivityItem {
  txid: string;
  blockHeight: bigint;
  type: string;
  ticker?: string;
  amountAtoms?: TokenAtoms;
  btcSats?: Sats;
  timestamp: string;
}

export interface CanonicalActivityPage {
  items: CanonicalActivityItem[];
  nextCursor: string | null;
}

export interface CanonicalCRCProvider {
  getCapabilities(): Promise<CRCCapabilities>;
  validateTicker(ticker: string): Promise<TickerValidation>;
  requestDeploymentAuthorization(
    params: DeploymentAuthorizationRequest,
  ): Promise<DeploymentAuthorization>;
  getDeploymentRules(): Promise<DeploymentRules>;
  getMintRules(deploymentId: string): Promise<MintRules>;
  requestMintAuthorization(request: MintAuthorizationRequest): Promise<MintAuthorization>;
  submitSignedOperation(operation: SignedCRCOperation): Promise<CRCSubmissionResult>;
  getOperationStatus(operationId: string): Promise<CRCOperationStatus>;
  getCanonicalState(deploymentId: string): Promise<CanonicalTokenState>;
  getCanonicalActivity(cursor?: string): Promise<CanonicalActivityPage>;
}
