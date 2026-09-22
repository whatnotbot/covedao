import type { Network, RuntimeConfig } from "./types.js";

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function str(env: Env, key: string, fallback = ""): string {
  const v = env[key];
  if (v === undefined || v === "") return fallback;
  return v;
}

function bool(env: Env, key: string, fallback = false): boolean {
  const v = env[key];
  if (v === undefined || v === "") return fallback;
  return ["true", "1", "yes", "on"].includes(v.toLowerCase());
}

function int(env: Env, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new ConfigError(`Environment variable ${key} must be an integer.`);
  return n;
}

function bigintOrNull(env: Env, key: string): bigint | null {
  const v = env[key];
  if (v === undefined || v === "") return null;
  try {
    return BigInt(v);
  } catch {
    throw new ConfigError(`Environment variable ${key} must be a base-10 integer.`);
  }
}

function parseNetwork(raw: string): Network {
  switch (raw) {
    case "mock":
    case "test":
    case "mainnet":
    case "mainnet-read-only":
      return raw;
    case "mutinynet":
    case "signet":
    case "regtest":
    case "testnet":
      return "test";
    default:
      throw new ConfigError(
        `Unknown CRC_NETWORK "${raw}". Expected mock, test, mainnet, or mainnet-read-only.`,
      );
  }
}

/** Load a RuntimeConfig from a process-like environment object. */
export function loadConfig(env: Env): RuntimeConfig {
  const nodeEnvRaw = str(env, "NODE_ENV", "development");
  const nodeEnv =
    nodeEnvRaw === "production"
      ? "production"
      : nodeEnvRaw === "test"
        ? "test"
        : "development";

  const network = parseNetwork(str(env, "CRC_NETWORK", "mock"));

  const config: RuntimeConfig = {
    nodeEnv,
    appUrl: str(env, "APP_URL", "http://localhost:3000"),
    appName: str(env, "NEXT_PUBLIC_APP_NAME", "CRC Launch"),
    databaseUrl: str(env, "DATABASE_URL", ""),
    redisUrl: str(env, "REDIS_URL", "redis://localhost:6379"),
    network,
    protocolUrl: str(env, "CRC_PROTOCOL_URL") || null,
    protocolVerified: bool(env, "CRC_PROTOCOL_VERIFIED", false),
    flags: {
      deployMainnet: bool(env, "CRC_DEPLOY_MAINNET_ENABLED", false),
      mintMainnet: bool(env, "CRC_MINT_MAINNET_ENABLED", false),
      marketMainnet: bool(env, "CRC_MARKET_MAINNET_ENABLED", false),
      graduationMainnet: bool(env, "CRC_GRADUATION_MAINNET_ENABLED", false),
    },
    bitcoinRpc: str(env, "BITCOIN_RPC_URL")
      ? {
          url: str(env, "BITCOIN_RPC_URL"),
          user: str(env, "BITCOIN_RPC_USER") || null,
          password: str(env, "BITCOIN_RPC_PASSWORD") || null,
        }
      : null,
    explorerUrl: str(env, "BITCOIN_EXPLORER_URL", "https://mempool.space"),
    treasuryAddress: str(env, "PLATFORM_TREASURY_ADDRESS") || null,
    launchFeeSats: bigintOrNull(env, "LAUNCH_FEE_SATS") ?? 10_000n,
    primaryMintFeeBps: bigintOrNull(env, "PRIMARY_MINT_FEE_BPS") ?? 100n,
    finalityConfirmations: int(env, "FINALITY_CONFIRMATIONS", 6),
    quoteTtlSeconds: int(env, "QUOTE_TTL_SECONDS", 120),
    quoteTtlBlocks: int(env, "QUOTE_TTL_BLOCKS", 2),
    maxMinerFeeSats: bigintOrNull(env, "MAX_MINER_FEE_SATS"),
    maxFeeRateSatVb: str(env, "MAX_FEE_RATE_SAT_VB")
      ? int(env, "MAX_FEE_RATE_SAT_VB", 0)
      : null,
    s3: str(env, "S3_ENDPOINT") && str(env, "S3_BUCKET")
      ? {
          endpoint: str(env, "S3_ENDPOINT"),
          bucket: str(env, "S3_BUCKET"),
          accessKey: str(env, "S3_ACCESS_KEY"),
          secretKey: str(env, "S3_SECRET_KEY"),
        }
      : null,
    sentryDsn: str(env, "SENTRY_DSN") || null,
    adminAuthSecret: str(env, "ADMIN_AUTH_SECRET") || null,
  };

  return config;
}

/** True when the configured network implies a Bitcoin mainnet context. */
export function isMainnetNetwork(network: Network): boolean {
  return network === "mainnet" || network === "mainnet-read-only";
}

/**
 * Startup assertions. Throws ConfigError when a write-enabled mainnet
 * configuration is internally inconsistent (e.g. missing treasury or an
 * invalid treasury network).
 */
export function validateConfig(config: RuntimeConfig): void {
  if (config.nodeEnv === "production" && config.adminAuthSecret === null) {
    throw new ConfigError(
      "ADMIN_AUTH_SECRET is required in production. Set a strong random secret.",
    );
  }

  const writesEnabled = Object.values(config.flags).some(Boolean);
  if (isMainnetNetwork(config.network) && writesEnabled) {
    if (!config.protocolVerified) {
      // Fail closed — must be explicit.
      throw new ConfigError(
        "A mainnet write flag is enabled but CRC_PROTOCOL_VERIFIED is false. " +
          "Refusing to boot. Verify the protocol first.",
      );
    }
    if (!config.treasuryAddress) {
      throw new ConfigError(
        "PLATFORM_TREASURY_ADDRESS is required when mainnet writes are enabled.",
      );
    }
  }

  if (config.treasuryAddress) {
    // Address-network sanity check (bc1* = mainnet/bech32, tb1* = testnet).
    const isMainnetAddr = /^(bc1|[13])/.test(config.treasuryAddress);
    const isTestnetAddr = /^(tb1|[mn2])/.test(config.treasuryAddress);
    if (isMainnetNetwork(config.network) && !isMainnetAddr && !isTestnetAddr) {
      throw new ConfigError(
        "PLATFORM_TREASURY_ADDRESS does not look like a valid Bitcoin address.",
      );
    }
    if (isMainnetNetwork(config.network) && isTestnetAddr) {
      throw new ConfigError(
        "PLATFORM_TREASURY_ADDRESS is a testnet address but the network is mainnet. " +
          "This is a fatal configuration error.",
      );
    }
    if (config.network === "test" && isMainnetAddr) {
      throw new ConfigError(
        "PLATFORM_TREASURY_ADDRESS is a mainnet address but the network is testnet.",
      );
    }
  }
}
