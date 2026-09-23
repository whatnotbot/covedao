export type Network = "mock" | "test" | "mainnet" | "mainnet-read-only";

export type ProtocolHealthState = "HEALTHY" | "DEGRADED" | "UNSAFE";

export interface ProtocolHealth {
  state: ProtocolHealthState;
  synced: boolean;
  stateValid: boolean;
  lagBlocks: bigint;
}

export interface FeatureFlags {
  /** CRC_DEPLOY_MAINNET_ENABLED */
  deployMainnet: boolean;
  /** CRC_MINT_MAINNET_ENABLED */
  mintMainnet: boolean;
  /** CRC_MARKET_MAINNET_ENABLED */
  marketMainnet: boolean;
  /** CRC_GRADUATION_MAINNET_ENABLED */
  graduationMainnet: boolean;
}

export interface CoveFeatureFlags {
  /** COVE_MAINNET_ENABLED */
  mainnetEnabled: boolean;
  /** COVE_DEPLOY_MAINNET_ENABLED */
  deployMainnet: boolean;
  /** COVE_MINT_MAINNET_ENABLED */
  mintMainnet: boolean;
  /** COVE_TRANSFER_MAINNET_ENABLED */
  transferMainnet: boolean;
}

export interface BitcoinRpcConfig {
  url: string;
  user: string | null;
  password: string | null;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  appUrl: string;
  appName: string;
  databaseUrl: string;
  redisUrl: string;
  network: Network;
  protocolUrl: string | null;
  protocolVerified: boolean;
  flags: FeatureFlags;
  coveFlags: CoveFeatureFlags;
  /** COVE_V1_MAINNET_GENESIS_HEIGHT — null until the owner canary is recorded. */
  coveMainnetGenesisHeight: bigint | null;
  /** COVE_V1_MAINNET_CANARY_TXID — the confirmed canary DEPLOY txid, if recorded. */
  coveMainnetCanaryTxid: string | null;
  bitcoinRpc: BitcoinRpcConfig | null;
  explorerUrl: string;
  treasuryAddress: string | null;
  launchFeeSats: bigint;
  primaryMintFeeBps: bigint;
  finalityConfirmations: number;
  quoteTtlSeconds: number;
  quoteTtlBlocks: number;
  s3: S3Config | null;
  sentryDsn: string | null;
  adminAuthSecret: string | null;
}
