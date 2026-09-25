import type { Database } from "@crclaunch/db";
import {
  LocalGuardianTransitionSigner,
  RemoteGuardianTransitionSigner,
  HttpGuardianTransport,
  localSigningBackend,
  GuardianV3Signer,
  type GuardianRiskPolicy,
  type GuardianTransitionSigner,
  type GuardianTransport,
} from "@crclaunch/cove-guardian/v3";
import { PostgresSigningJournal } from "./journal.js";
import { PostgresGuardianAudit } from "./audit.js";
import { AppError } from "./errors.js";
import type { V3AppConfig } from "./config.js";

/**
 * Build the application's transition signer (§C4). The app NEVER signs through
 * the raw `validateAndSignMint/RedeemTransition` fallback — it always goes
 * through a `GuardianTransitionSigner`, which owns the durable journal + audit +
 * risk policy. Non-mainnet uses a local signer; mainnet uses the remote Guardian
 * service (fail-closed when no endpoint is configured).
 */

function failClosedTransport(): GuardianTransport {
  return {
    health: async () => { throw new Error("guardian endpoint not configured"); },
    sign: async () => { throw new Error("guardian endpoint not configured"); },
  };
}

export const DEV_RISK_POLICY: GuardianRiskPolicy = {
  // The product's per-mint spending limit. Big buyers mint several times and
  // pay the flat mint fee each time. No token-count limit: at stage 1 one
  // would cap a mint far below the flat fee.
  maxGrossSats: 200_000n,
  maxMintAtoms: 1_000_000_000n * 100_000_000n,
  minMintGrossSats: 0n,
  maxRedeemPayoutSats: 1_000_000n,
  maxBackingSats: 100_000_000_000_000n,
  maxMinerFeeSats: 20_000n,
  allowedTokenIds: [],
  enforceTokenAllowlist: false,
};

export function buildAppTransitionSigner(db: Database, config: V3AppConfig): GuardianTransitionSigner {
  if (config.network !== "mainnet") {
    if (!config.guardianPrivateKey) {
      throw new AppError("GUARDIAN_UNAVAILABLE", "local Guardian key required for non-mainnet signing");
    }
    const signer = GuardianV3Signer.fromPrivateKey(config.guardianPrivateKey);
    return new LocalGuardianTransitionSigner(
      localSigningBackend(signer),
      new PostgresSigningJournal(db),
      new PostgresGuardianAudit(db, config.recoveryProfile?.profileVersion ?? "COVE_V3_VAULT_PROFILE_DEV1"),
      {
        ...DEV_RISK_POLICY,
        maxMinerFeeSats: config.maxMinerFeeSats,
        ...(config.mintLimits?.maxGrossSats != null ? { maxGrossSats: config.mintLimits.maxGrossSats } : {}),
      },
    );
  }

  const transport: GuardianTransport = config.guardianEndpoint
    ? new HttpGuardianTransport(config.guardianEndpoint, config.guardianAuthToken ?? "")
    : failClosedTransport();
  return new RemoteGuardianTransitionSigner(
    transport,
    config.mainnetProfileHash ?? "",
    config.guardianXOnly.toString("hex"),
  );
}
