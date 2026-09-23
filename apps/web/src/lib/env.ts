import "dotenv/config";
import { loadConfig, validateConfig, type RuntimeConfig } from "@crclaunch/config";

const globalForEnv = globalThis as unknown as { __crcConfig?: RuntimeConfig };

export function getConfig(): RuntimeConfig {
  if (!globalForEnv.__crcConfig) {
    const config = loadConfig(process.env);
    // Fail closed: a missing ADMIN_AUTH_SECRET in production, a mainnet write
    // flag with an unverified protocol, or a wrong-network treasury must refuse
    // to start the app — not log and continue.
    validateConfig(config);
    globalForEnv.__crcConfig = config;
  }
  return globalForEnv.__crcConfig;
}
