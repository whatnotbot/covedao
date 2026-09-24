import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CHAIN_BITCOIN_REGTEST, CHAIN_BITCOIN_SIGNET, CHAIN_BITCOIN_TESTNET, CHAIN_BITCOIN_MAINNET } from "@crclaunch/cove-wire";
import { loadMainnetProfile, type MainnetProfile } from "@crclaunch/cove-mainnet";
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
  feeScript: Buffer;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  /** Optional versioned recovery profile (MAINNET1); defaults to DEV1 single-key. */
  recoveryProfile?: VaultRecoveryProfile;
  /** Guardian private key (server-side secret, regtest/staging ONLY). */
  guardianPrivateKey: Buffer | null;
  maxMinerFeeSats: bigint;
  maxListingBlocks: bigint;
  reservationTtlSeconds: number;
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
      feeScript: Buffer.from(profile.feeScript!, "hex"),
      guardianXOnly: Buffer.from(profile.guardianXOnly!, "hex"),
      recoveryKeyXOnly: recoveryProfile.recoveryPubkeys[0]!, // unused for MAINNET1
      recoveryProfile,
      guardianPrivateKey: null,
      maxMinerFeeSats: 20_000n,
      maxListingBlocks: 21_000n,
      reservationTtlSeconds: 90,
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
    feeScript: p2wpkh(feePriv),
    guardianXOnly: xonly(guardianPriv ?? recoveryPriv),
    recoveryKeyXOnly: xonly(recoveryPriv),
    guardianPrivateKey: guardianPriv,
    maxMinerFeeSats: 20_000n,
    maxListingBlocks: 21_000n,
    reservationTtlSeconds: 90,
  };
}
