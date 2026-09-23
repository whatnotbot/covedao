import type { CoveConfig } from "@crclaunch/protocol";

/**
 * Canonical Cove V1 configuration for Bitcoin SIGNET.
 *
 * The treasury and reserve are documented PLACEHOLDER scripts for this sprint.
 * They are pure constants (trusted config, never user input), and must be
 * replaced with the platform's real signet addresses before any mainnet/signet
 * deployment. No one holds keys for the placeholders, so nothing is spendable.
 */
export const COVE_SIGNET_CONFIG: CoveConfig = {
  // Placeholder key-path P2TR (OP_1 0x20 <32 bytes>).
  treasuryScript: "5120" + "c0".repeat(32),
  // Placeholder P2WPKH (0x00 0x14 <20 bytes>).
  reserveScript: "0014" + "b0".repeat(20),
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  supportedScriptPrefixes: ["0014", "5120"],
};
