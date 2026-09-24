import "dotenv/config";
import { createDb, type Database } from "@crclaunch/db";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { GuardianV3Signer, LocalGuardianTransitionSigner, type GuardianTransitionSigner } from "@crclaunch/cove-guardian/v3";
import { loadV3AppConfig, V3AppService, PostgresSigningJournal, PostgresGuardianAudit, type V3AppConfig } from "@crclaunch/cove-app";
import { AppError } from "@crclaunch/cove-app";

/**
 * Production V3 server runtime (§6/§7/§8/§11/§12). Real Core RPC + real Postgres.
 * Regtest/staging MAY use a local Guardian key; mainnet requires the remote
 * transition signer (fail-closed). No PrecopCRCAdapter, no MockChainNode, no
 * mock Bitcoin provider.
 */

export interface V3Services {
  config: V3AppConfig;
  db: Database;
  provider: CoreRpcProvider;
  signer: GuardianV3Signer | null;
  transitionSigner: GuardianTransitionSigner | null;
  app: V3AppService;
}

const globalForV3 = globalThis as unknown as { __coveV3Services?: V3Services };

export function getV3Services(): V3Services {
  if (globalForV3.__coveV3Services) return globalForV3.__coveV3Services;
  const config = loadV3AppConfig(process.env);
  const db = createDb(process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
  const provider = new CoreRpcProvider({
    url: config.coreRpcUrl,
    user: config.coreRpcUser,
    password: config.coreRpcPassword,
  });
  const signer = config.guardianPrivateKey ? GuardianV3Signer.fromPrivateKey(config.guardianPrivateKey) : null;

  // Durable-before-sign transition signer (journal + audit) for non-mainnet when a
  // local Guardian key exists; mainnet requires a remote production signer (§15).
  let transitionSigner: GuardianTransitionSigner | null = null;
  if (signer) {
    transitionSigner = new LocalGuardianTransitionSigner(
      signer,
      new PostgresSigningJournal(db),
      new PostgresGuardianAudit(db, config.recoveryProfile?.profileVersion ?? "COVE_V3_VAULT_PROFILE_DEV1"),
      { maxGrossSats: 1_000_000n, maxRedeemPayoutSats: 1_000_000n, maxBackingSats: 100_000_000_000_000n, maxMinerFeeSats: config.maxMinerFeeSats, allowedTokenIds: null },
    );
  }

  const app = new V3AppService(db, provider, config, signer, transitionSigner);
  const services: V3Services = { config, db, provider, signer, transitionSigner, app };
  globalForV3.__coveV3Services = services;
  return services;
}

export function assertV3Enabled(): V3Services {
  const s = getV3Services();
  if (!s.config.enabled) throw new AppError("APP_DISABLED", "Cove V3 application is disabled");
  return s;
}
