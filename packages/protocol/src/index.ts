export type {
  ProtocolOperation,
  OperationStatus,
  ProtocolTxStatus,
  ProtocolToken,
  ProtocolEventType,
  ProtocolEvent,
  ProtocolTransactionStatus,
  OutputKind,
  TransactionOutput,
  TransactionInput,
  TransactionSummary,
  UnsignedProtocolTransaction,
  ValidationResult,
  BuildDeployInput,
  BuildMintInput,
  BuildSellInput,
  BuildBuyInput,
  BuildCancelInput,
  DecodedProtocolTransaction,
  VerificationStatus,
  FeeBreakdown,
  ProtocolListing,
  DecodedSignedTransaction,
} from "./types.js";
export type { CRCProtocolAdapter } from "./adapter.js";
export { ProtocolError, isProtocolError, type ProtocolErrorCode } from "./errors.js";
export {
  VERIFIED,
  UNVERIFIED,
  PRECOP_MAINNET_VERIFICATION,
  MOCK_VERIFICATION,
} from "./verification.js";

export { MockCRCAdapter, toProtocolToken, toProtocolEvent } from "./mock/adapter.js";
export { MockChainNode, type MockHealth } from "./mock/node.js";
export { MemoryStorage, RedisMockStorage, type MockStorage, type RedisLike } from "./mock/store.js";
export {
  createInitialState,
  mineBlock,
  reorg,
  rebuildDerivedState,
  getStateHash,
  ensureWallet,
  getConfirmedEvents,
  assertProtocolInvariants,
  MOCK_FAUCET_SATS,
} from "./mock/chain.js";
export {
  DEFAULT_MOCK_PROTOCOL_CONFIG,
  MOCK_TREASURY_ADDRESS,
  MOCK_RESERVE_ADDRESS,
  MOCK_PROTOCOL_FEE_ADDRESS,
  CRC_LAUNCH_V1_PROFILE,
  type ProtocolConfig,
} from "./validation/config.js";
export {
  outputsToAddress,
  sumOutputsByKind,
  findOutputByKind,
  countOutputsByKind,
  countOutputsToAddress,
  type OpValidationResult,
} from "./validation/common.js";
export type {
  MockChainState,
  MockToken,
  MockListing,
  MockEvent,
  MockTx,
  MockTxEnvelope,
  MockBlock,
  MockTxStatus,
  WalletBalance,
} from "./mock/types.js";
export {
  buildEnvelope,
  envelopeToPsbt,
  envelopeFromPsbt,
  parseSignedMockPsbt,
  isMockSignedPsbt,
  newMockTxid,
} from "./mock/envelope.js";
export { seedMockChain } from "./mock/seed.js";

export { PrecopCRCAdapter } from "./precop.js";
export {
  decodeCrc20Json,
  decodeCrc20OpReturn,
  OBSERVED_LEAF_TRANSFER,
  type Crc20Payload,
} from "./crc20.js";
export type {
  CanonicalCRCProvider,
  CRCCapabilities,
  TickerValidation,
  DeploymentAuthorizationRequest,
  DeploymentAuthorization,
  DeploymentRules,
  MintRules,
  MintAuthorizationRequest,
  MintAuthorization,
  SignedCRCOperation,
  CRCSubmissionResult,
  CRCOperationStatus,
  CanonicalTokenState,
  CanonicalActivityItem,
  CanonicalActivityPage,
  CanonicalOperationKind,
} from "./canonical.js";
export {
  MockCanonicalCRCProvider,
  UnavailableCanonicalCRCProvider,
  crcLaunchV1DeploymentRules,
} from "./canonical-mock.js";

export {
  parseCoveEnvelope,
  COVE_PROTOCOL,
  COVE_VERSION,
  type CoveEnvelope,
  type CoveOp,
  type CoveDeploy,
  type CoveMint,
  type CoveTransfer,
  type CoveParseResult,
} from "./cove/parser.js";
export {
  createCoveState,
  type CoveState,
  type CoveToken,
  type CoveBalance,
  type CoveTransaction,
  type CoveOperationKind,
  type ProtocolOwnerId,
  type CoveProtocolOutput,
  type CoveValidationResult,
} from "./cove/types.js";
export { validateCoveOperation, applyCoveOperation, type CoveConfig } from "./cove/validator.js";
export { toCoveTransaction, type CoveMapResult } from "./cove/mapper.js";
export { computeStateRoot } from "./cove/state-root.js";
export {
  buildCoveDeployPsbt,
  buildCoveMintPsbt,
  buildCoveTransferPsbt,
  RECIPIENT_DUST_SATS,
  type BuildDeployParams,
  type BuildMintParams,
  type BuildTransferParams,
} from "./cove/build.js";
