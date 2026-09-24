import "dotenv/config";
import { createDb, type Database } from "@crclaunch/db";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { GuardianV3Signer } from "@crclaunch/cove-guardian/v3";
import { loadV3AppConfig, V3AppService, type V3AppConfig } from "@crclaunch/cove-app";
import { AppError } from "@crclaunch/cove-app";

/**
 * Production V3 server runtime (§6/§7/§8). Real Core RPC + real Postgres + real
 * Guardian signer (server-side secret, regtest/staging ONLY). No PrecopCRCAdapter,
 * no MockChainNode, no mock Bitcoin provider.
 */

export interface V3Services {
  config: V3AppConfig;
  db: Database;
  provider: CoreRpcProvider;
  signer: GuardianV3Signer | null;
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
  const app = new V3AppService(db, provider, config, signer);
  const services: V3Services = { config, db, provider, signer, app };
  globalForV3.__coveV3Services = services;
  return services;
}

export function assertV3Enabled(): V3Services {
  const s = getV3Services();
  if (!s.config.enabled) throw new AppError("APP_DISABLED", "Cove V3 application is disabled");
  return s;
}
