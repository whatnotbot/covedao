import "dotenv/config";
import { loadConfig, type RuntimeConfig } from "@crclaunch/config";

const globalForEnv = globalThis as unknown as { __crcConfig?: RuntimeConfig };

export function getConfig(): RuntimeConfig {
  if (!globalForEnv.__crcConfig) {
    globalForEnv.__crcConfig = loadConfig(process.env);
  }
  return globalForEnv.__crcConfig;
}
