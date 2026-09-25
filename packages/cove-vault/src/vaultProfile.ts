import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";

/**
 * Versioned Cove V3 vault security profiles (§2/§3/§4 of Phase 8). The vault
 * shape (NUMS internal key + MINT/REDEEM execution leaves + recovery leaf)
 * changes ONLY when the recovery architecture changes. DEV1 is the historical
 * single-key 144-CSV profile kept for regtest/golden compatibility; MAINNET1 is
 * the production threshold-recovery profile. Changing a profile changes the
 * MAST/merkle root/output key/scriptPubKey, so it is explicitly versioned and
 * golden-tested — never silently mutated.
 */

export type VaultProfileVersion = "COVE_V3_VAULT_PROFILE_DEV1" | "COVE_V3_VAULT_PROFILE_MAINNET1";

export interface VaultRecoveryProfile {
  profileVersion: VaultProfileVersion;
  /** Relative CSV delay before recovery is spendable. */
  recoveryCsvBlocks: number;
  /** Recovery threshold (of pubkeys). */
  recoveryThreshold: number;
  /** Sorted x-only recovery pubkeys (32 bytes each). Lexicographic ordering. */
  recoveryPubkeys: Buffer[];
}

const OP_DROP = 0x75;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_CHECKSIG = 0xac;
const OP_CHECKSIGADD = 0xba;
const OP_NUMEQUAL = 0x9c;

/** Sort x-only pubkeys lexicographically (raw bytes) — deterministic key order. */
export function sortRecoveryPubkeys(pubkeys: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  for (const k of pubkeys) {
    if (k.length !== 32) throw new Error("recovery pubkeys must be 32-byte x-only keys");
    if (!ecc.isXOnlyPoint(k)) throw new Error("recovery pubkey is not on the secp256k1 curve");
    const hex = k.toString("hex");
    if (seen.has(hex)) throw new Error(`duplicate recovery pubkey ${hex}`);
    seen.add(hex);
  }
  return [...pubkeys].sort((a, b) => Buffer.compare(a, b));
}

/**
 * Threshold recovery tapscript: `<csv> CSV DROP <K1> CHECKSIG <K2> CHECKSIGADD …
 * <Kn> CHECKSIGADD <threshold> NUMEQUAL` (§4). CSV (BIP112) inspects without
 * popping, so DROP removes the csv operand; each CHECKSIG/CHECKSIGADD consumes
 * one signature (empty vector = false, per BIP342 NULLFAIL semantics).
 */
export function buildThresholdRecoveryLeaf(csvBlocks: number, threshold: number, pubkeys: Buffer[]): Buffer {
  if (!Number.isInteger(csvBlocks) || csvBlocks <= 0) throw new Error("csvBlocks must be positive");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 16) throw new Error("threshold must be 1..16");
  if (threshold > pubkeys.length) throw new Error("threshold exceeds pubkey count");
  const keys = sortRecoveryPubkeys(pubkeys);
  const ops: (number | Buffer)[] = [
    bitcoin.script.number.encode(csvBlocks),
    OP_CHECKSEQUENCEVERIFY,
    OP_DROP,
  ];
  for (let i = 0; i < keys.length; i++) {
    ops.push(keys[i]!);
    ops.push(i === 0 ? OP_CHECKSIG : OP_CHECKSIGADD);
  }
  ops.push(0x50 + threshold); // OP_1..OP_16
  ops.push(OP_NUMEQUAL);
  return bitcoin.script.compile(ops) as Buffer;
}

/**
 * Recovery witness stack (excluding script + control block): one signature slot
 * per pubkey in REVERSE key order (the first CHECKSIG consumes the top item).
 * Empty Buffer marks an absent key (CHECKSIG → false). Exactly `threshold`
 * non-empty signatures are emitted so the final `OP_<threshold> NUMEQUAL` passes
 * — if more than `threshold` signatures are supplied they are truncated to the
 * first `threshold` in sorted-key order (§C8).
 */
export function buildThresholdRecoveryWitness(params: {
  pubkeys: Buffer[];
  signatures: Map<string, Buffer>;
  threshold: number;
}): Buffer[] {
  const keys = sortRecoveryPubkeys(params.pubkeys);
  const present = keys.filter((k) => params.signatures.has(k.toString("hex")));
  if (present.length < params.threshold) {
    throw new Error(`recovery threshold not met: ${present.length}/${params.threshold} signatures`);
  }
  const used = new Set(present.slice(0, params.threshold).map((k) => k.toString("hex")));
  const stack: Buffer[] = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const sig = used.has(keys[i]!.toString("hex")) ? params.signatures.get(keys[i]!.toString("hex")) : undefined;
    stack.push(sig ? Buffer.from(sig) : Buffer.alloc(0));
  }
  return stack;
}

/** The historical DEV1 recovery leaf: `<144> CSV 2DROP <owner> CHECKSIG`. */
export function buildDev1RecoveryLeaf(ownerXOnly: Buffer): Buffer {
  if (ownerXOnly.length !== 32) throw new Error("ownerXOnly must be 32 bytes");
  return bitcoin.script.compile([
    bitcoin.script.number.encode(144),
    OP_CHECKSEQUENCEVERIFY,
    0x6d, // OP_2DROP
    ownerXOnly,
    OP_CHECKSIG,
  ]) as Buffer;
}

/** Build the recovery leaf for a versioned profile. */
export function buildRecoveryLeafForProfile(profile: VaultRecoveryProfile): Buffer {
  if (profile.profileVersion === "COVE_V3_VAULT_PROFILE_DEV1") {
    if (profile.recoveryPubkeys.length !== 1) throw new Error("DEV1 requires exactly one recovery key");
    return buildDev1RecoveryLeaf(profile.recoveryPubkeys[0]!);
  }
  if (profile.profileVersion === "COVE_V3_VAULT_PROFILE_MAINNET1") {
    return buildThresholdRecoveryLeaf(profile.recoveryCsvBlocks, profile.recoveryThreshold, profile.recoveryPubkeys);
  }
  throw new Error(`unknown vault profile ${profile.profileVersion}`);
}

/** DEV1 profile: single key, 144 blocks (historical/regtest golden). */
export function dev1RecoveryProfile(ownerXOnly: Buffer): VaultRecoveryProfile {
  return {
    profileVersion: "COVE_V3_VAULT_PROFILE_DEV1",
    recoveryCsvBlocks: 144,
    recoveryThreshold: 1,
    recoveryPubkeys: [Buffer.from(ownerXOnly)],
  };
}
