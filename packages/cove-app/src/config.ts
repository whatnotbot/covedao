import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CHAIN_BITCOIN_REGTEST, CHAIN_BITCOIN_SIGNET, CHAIN_BITCOIN_TESTNET, CHAIN_BITCOIN_MAINNET } from "@crclaunch/cove-wire";
import { loadMainnetProfile, hashMainnetProfile, type MainnetProfile } from "@crclaunch/cove-mainnet";
import { COVE_FEE_CONFIG } from "@crclaunch/cove-economics";
import { AppError } from "./errors.js";
import type { VaultRecoveryProfile } from "@crclaunch/cove-vault";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

export type V3Network = "regtest" | "signet" | "testnet" | "mainnet";

export interface V3AppConfig {
  enabled: boolean;
  network: V3Network;
  chainIdentity: string;
  coreRpcUrl: string;
  coreRpcUser: string;
  coreRpcPassword: string;
  /** Optional secondary Core URL for the two-node quorum (§29/§P1-2). */
  coreRpcUrlSecondary?: string;
  feeScript: Buffer;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  /** Optional versioned recovery profile (MAINNET1); defaults to DEV1 single-key. */
  recoveryProfile?: VaultRecoveryProfile;
  /** Guardian private key (server-side secret, regtest/staging ONLY). */
  guardianPrivateKey: Buffer | null;
  /** Absolute activation height (0 = genesis); Cove ops below this are ignored. */
  activationHeight: bigint;
  /** Canary token allowlist (hex); enforced at the app/signer during canary. */
  canaryAllowedTokenIds?: string[];
  /** Canary wallet-script allowlist (hex); enforced at the app during canary. */
  canaryAllowedWalletScripts?: string[];
  /** P2P fee bps (mainnet: from the profile). */
  p2pFeeBps?: number;
  /** Protocol backing-buy fee, basis points (§P1-4; mainnet: from the profile). */
  buyFeeBps: bigint;
  /** Flat buy-fee component at the TOP stage; scaled down for earlier stages. */
  buyFeeFlatSatsAtTopStage: bigint;
  /**
   * Emit the advisory crc-20 discovery envelope (§D1). OFF by default: it needs
   * two OP_RETURNs per transaction, which Bitcoin Core rejects as
   * `multi-op-return` before v30 relaxed the datacarrier policy.
   */
  discoveryEnvelope: boolean;
  /** Protocol backing-redeem fee, basis points (§P1-4; mainnet: from the profile). */
  redeemFeeBps: bigint;
  /** Flat redemption fee, not stage-scaled — the exit price should be predictable. */
  redeemFeeFlatSats: bigint;
  /** Canary P2P settlement cap (mainnet: from the profile). */
  maxP2pSettlementSats?: bigint;
  maxMinerFeeSats: bigint;
  maxListingBlocks: bigint;
  reservationTtlSeconds: number;
  /** Committed profile hash (mainnet) — used to verify the remote Guardian (§P1-2/C4). */
  mainnetProfileHash?: string;
  /** Remote Guardian service endpoint (mainnet). */
  guardianEndpoint?: string;
  /** Remote Guardian service bearer token (mainnet). */
  guardianAuthToken?: string;
}

const REGTEST_GUARDIAN_PRIV = Buffer.alloc(32, 0x42);
const REGTEST_RECOVERY_PRIV = Buffer.alloc(32, 0x43);
const REGTEST_FEE_PRIV = Buffer.alloc(32, 0x44);

function xonly(priv: Buffer): Buffer {
  const key = ECPair.fromPrivateKey(priv, { network: bitcoin.networks.regtest });
  return Buffer.from(key.publicKey.subarray(1));
}

function p2wpkh(priv: Buffer): Buffer {
  const key = ECPair.fromPrivateKey(priv, { network: bitcoin.networks.regtest });
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest }).output!;
}

function parseNetwork(raw: string): V3Network {
  switch (raw) {
    case "regtest":
      return "regtest";
    case "signet":
      return "signet";
    case "testnet":
      return "testnet";
    case "mainnet":
      return "mainnet";
    default:
      throw new AppError("WRONG_NETWORK", `unsupported Cove V3 network "${raw}"`);
  }
}

function chainIdentityFor(network: V3Network): string {
  switch (network) {
    case "regtest":
      return CHAIN_BITCOIN_REGTEST;
    case "signet":
      return CHAIN_BITCOIN_SIGNET;
    case "testnet":
      return CHAIN_BITCOIN_TESTNET;
    case "mainnet":
      return CHAIN_BITCOIN_MAINNET;
  }
}

function hexOrNull(v: string | undefined): Buffer | null {
  if (!v) return null;
  const b = Buffer.from(v, "hex");
  if (b.length !== 32) throw new AppError("GUARDIAN_UNAVAILABLE", "private key hex must be 32 bytes");
  return b;
}

type Env = Record<string, string | undefined>;

/** Map the canonical mainnet profile's recovery to a VaultRecoveryProfile. */
export function recoveryProfileFromMainnetProfile(profile: MainnetProfile): VaultRecoveryProfile {
  if (profile.recovery.pubkeys.length !== 3 || profile.recovery.csvBlocks == null) {
    throw new AppError("MAINNET_DISABLED", "mainnet profile recovery is incomplete");
  }
  return {
    profileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
    recoveryCsvBlocks: profile.recovery.csvBlocks,
    recoveryThreshold: profile.recovery.threshold,
    recoveryPubkeys: profile.recovery.pubkeys.map((k) => Buffer.from(k, "hex")),
  };
}

/** Load the committed public profile for mainnet (no private keys). */
function loadMainnetConfig(env: Env): MainnetProfile {
  const profilePath = env.COVE_V3_MAINNET_PROFILE_PATH ?? ".cove-v3-mainnet-profile.json";
  const { profile, validation } = loadMainnetProfile(profilePath);
  if (!validation.ok) {
    throw new AppError("MAINNET_DISABLED", `invalid mainnet profile: ${validation.errors.join("; ")}`);
  }
  if (profile.guardianXOnly == null || profile.feeScript == null) {
    throw new AppError("MAINNET_DISABLED", "mainnet profile missing guardianXOnly/feeScript");
  }
  return profile;
}

export function loadV3AppConfig(env: Env): V3AppConfig {
  const enabled = ["true", "1", "yes", "on"].includes((env.COVE_V3_APP_ENABLED ?? "").toLowerCase());
  const network = parseNetwork(env.COVE_NETWORK ?? env.CRC_NETWORK ?? "regtest");

  const coreRpcUrl =
    env.COVE_BITCOIN_RPC_URL ?? env.COVE_REGTEST_RPC_URL ?? env.BITCOIN_RPC_URL ?? "http://127.0.0.1:18443";
  const coreRpcUser = env.COVE_BITCOIN_RPC_USER ?? env.COVE_REGTEST_RPC_USER ?? env.BITCOIN_RPC_USER ?? "user";
  const coreRpcPassword = env.COVE_BITCOIN_RPC_PASSWORD ?? env.COVE_REGTEST_RPC_PASSWORD ?? env.BITCOIN_RPC_PASSWORD ?? "pass";
  const coreRpcUrlSecondary = env.COVE_BITCOIN_RPC_URL_SECONDARY;

  // Mainnet: public profile ONLY. Any local private-key env var is fatal (§15).
  if (network === "mainnet") {
    if (env.COVE_GUARDIAN_PRIVATE_KEY_HEX || env.COVE_RECOVERY_PRIVATE_KEY_HEX || env.COVE_FEE_PRIVATE_KEY_HEX) {
      throw new AppError("MAINNET_DISABLED", "mainnet must not load local Guardian/recovery/fee private keys");
    }
    const profile = loadMainnetConfig(env);
    const recoveryProfile = recoveryProfileFromMainnetProfile(profile);
    return {
      enabled,
      network,
      chainIdentity: CHAIN_BITCOIN_MAINNET,
      coreRpcUrl,
      coreRpcUser,
      coreRpcPassword,
      coreRpcUrlSecondary,
      feeScript: Buffer.from(profile.feeScript!, "hex"),
      guardianXOnly: Buffer.from(profile.guardianXOnly!, "hex"),
      recoveryKeyXOnly: recoveryProfile.recoveryPubkeys[0]!, // unused for MAINNET1
      recoveryProfile,
      guardianPrivateKey: null,
      activationHeight: profile.activationHeight ?? 0n,
      canaryAllowedTokenIds: profile.canary.allowedTokenIds,
      canaryAllowedWalletScripts: profile.canary.allowedWalletScripts,
      p2pFeeBps: profile.p2pFeeBps ?? undefined,
      buyFeeBps: BigInt(profile.buyFeeBps!),
      buyFeeFlatSatsAtTopStage: COVE_FEE_CONFIG.buyFeeFlatSatsAtTopStage,
      discoveryEnvelope: ["true", "1", "yes", "on"].includes((env.COVE_V3_DISCOVERY_ENVELOPE ?? "").toLowerCase()),
      redeemFeeBps: BigInt(profile.redeemFeeBps!),
      redeemFeeFlatSats: COVE_FEE_CONFIG.redeemFeeFlatSats,
      maxP2pSettlementSats: profile.canary.maxP2pSettlementSats ?? undefined,
      maxMinerFeeSats: 20_000n,
      maxListingBlocks: 21_000n,
      reservationTtlSeconds: 90,
      mainnetProfileHash: hashMainnetProfile(profile),
      guardianEndpoint: env.COVE_GUARDIAN_ENDPOINT,
      guardianAuthToken: env.COVE_GUARDIAN_AUTH_TOKEN,
    };
  }

  // Regtest defaults match the deterministic protocol fixture; staging must set
  // these explicitly.
  const guardianPriv = hexOrNull(env.COVE_GUARDIAN_PRIVATE_KEY_HEX) ?? (network === "regtest" ? REGTEST_GUARDIAN_PRIV : null);
  const recoveryPriv = hexOrNull(env.COVE_RECOVERY_PRIVATE_KEY_HEX) ?? (network === "regtest" ? REGTEST_RECOVERY_PRIV : null);
  const feePriv = hexOrNull(env.COVE_FEE_PRIVATE_KEY_HEX) ?? (network === "regtest" ? REGTEST_FEE_PRIV : null);

  if (!recoveryPriv || !feePriv) throw new AppError("GUARDIAN_UNAVAILABLE", "recovery/fee keys required for non-regtest");

  return {
    enabled,
    network,
    chainIdentity: chainIdentityFor(network),
    coreRpcUrl,
    coreRpcUser,
    coreRpcPassword,
    coreRpcUrlSecondary,
    feeScript: p2wpkh(feePriv),
    guardianXOnly: xonly(guardianPriv ?? recoveryPriv),
    recoveryKeyXOnly: xonly(recoveryPriv),
    guardianPrivateKey: guardianPriv,
    activationHeight: 0n,
    buyFeeBps: COVE_FEE_CONFIG.buyFeeBps,
    buyFeeFlatSatsAtTopStage: COVE_FEE_CONFIG.buyFeeFlatSatsAtTopStage,
    discoveryEnvelope: ["true", "1", "yes", "on"].includes((env.COVE_V3_DISCOVERY_ENVELOPE ?? "").toLowerCase()),
    redeemFeeBps: COVE_FEE_CONFIG.redeemFeeBps,
    redeemFeeFlatSats: COVE_FEE_CONFIG.redeemFeeFlatSats,
    maxMinerFeeSats: 20_000n,
    maxListingBlocks: 21_000n,
    reservationTtlSeconds: 90,
  };
}
