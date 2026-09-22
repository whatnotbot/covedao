import type { ProtocolHealth, RuntimeConfig } from "./types.js";

export type WriteOperation = "deploy" | "mint" | "market" | "graduation";

/** Product mode: which execution surface the application is running against. */
export type ProductMode = "DEMO" | "READ_ONLY_MAINNET" | "CANONICAL_CRC";

/**
 * Derive the product mode from the configured network + safety gates.
 * - DEMO: fully simulated (mock/test networks).
 * - READ_ONLY_MAINNET: real network, reads only.
 * - CANONICAL_CRC: real network with canonical write integration (cannot
 *   activate unless every protocol gate passes — see canWriteMainnet).
 */
export function productMode(config: RuntimeConfig): ProductMode {
  if (config.network === "mock" || config.network === "test") return "DEMO";
  if (config.network === "mainnet-read-only") return "READ_ONLY_MAINNET";
  return "CANONICAL_CRC";
}

function flagFor(config: RuntimeConfig, op: WriteOperation): boolean {
  switch (op) {
    case "deploy":
      return config.flags.deployMainnet;
    case "mint":
      return config.flags.mintMainnet;
    case "market":
      return config.flags.marketMainnet;
    case "graduation":
      return config.flags.graduationMainnet;
  }
}

/**
 * A mainnet write requires BOTH the specific feature flag AND
 * CRC_PROTOCOL_VERIFIED, plus a healthy, synced protocol.
 */
export function canWriteMainnet(
  config: RuntimeConfig,
  op: WriteOperation,
  health: ProtocolHealth,
): boolean {
  return (
    config.protocolVerified &&
    flagFor(config, op) &&
    health.synced &&
    health.stateValid
  );
}

/**
 * Whether the app should attempt real (non-mock) protocol interactions at all.
 * mainnet-read-only allows reads but never writes.
 */
export function isReadOnly(config: RuntimeConfig): boolean {
  return config.network === "mainnet-read-only";
}

export function isMock(config: RuntimeConfig): boolean {
  return config.network === "mock";
}

/** Human label for the "write mode" status indicator. */
export function writeModeLabel(config: RuntimeConfig, health: ProtocolHealth): string {
  const anyMainnetWrite = Object.values(config.flags).some(Boolean);
  if (!anyMainnetWrite) return "disabled";
  if (!config.protocolVerified) return "awaiting-verification";
  if (!health.synced || !health.stateValid) return "degraded";
  return "enabled";
}
