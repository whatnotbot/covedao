import { readFileSync, statSync } from "node:fs";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import {
  type GuardianV3Signer,
  computeVaultExecutionSighash,
  verifyVaultExecutionSignature,
  commitVaultExecutionWitness,
  type VaultLeafRef,
} from "./signer.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/**
 * Phase 8.1 custody backend boundary (§21-§23). The Guardian SERVICE signs only
 * through a `GuardianCustodyBackend`, which never exposes its private key. The
 * production backend may be an HSM/isolated process; until the operator selects
 * one, `UnconfiguredGuardianCustodyBackend` fails closed with
 * CUSTODY_BACKEND_NOT_CONFIGURED. `TestGuardianCustodyBackend` is REGTEST/tests
 * ONLY and is guarded by the secret-scan + architecture gates.
 */

export interface GuardianCustodyBackend {
  /** The x-only public key this backend signs with (32 bytes). */
  xOnlyPubkey(): Promise<Buffer>;
  /** Produce a 64-byte BIP340 Schnorr signature over a 32-byte sighash. */
  signTaprootScriptPath(params: { sighash: Buffer; leafTapleafHash: Buffer }): Promise<Buffer>;
}

/** REGTEST/tests-only custody backend backed by a deterministic local key. */
export class TestGuardianCustodyBackend implements GuardianCustodyBackend {
  private readonly key: ECPairInterface;
  private readonly xOnly: Buffer;
  constructor(priv: Buffer) {
    const ECPair = ECPairFactory(ecc);
    this.key = ECPair.fromPrivateKey(priv);
    this.xOnly = Buffer.from(this.key.publicKey.subarray(1));
  }
  async xOnlyPubkey(): Promise<Buffer> {
    return Buffer.from(this.xOnly);
  }
  async signTaprootScriptPath(params: { sighash: Buffer; leafTapleafHash: Buffer }): Promise<Buffer> {
    return Buffer.from(ecc.signSchnorr(params.sighash, this.key.privateKey!));
  }
}

/**
 * Production custody from a key FILE: the `guardian.key` the offline ceremony
 * writes (64 hex characters, mode 0600). The Guardian signs every mint and
 * redeem automatically, so this is a hot key: keep the file only on the
 * Guardian's own machine, on an encrypted disk, readable by its user alone.
 *
 * Loading refuses a file that group or others can read, a malformed key, and
 * (when `expectedXOnlyHex` is given) a key that is not the one the committed
 * profile names — so a wrong file cannot sign for the wrong vaults.
 */
export class FileGuardianCustodyBackend implements GuardianCustodyBackend {
  private readonly key: ECPairInterface;
  private readonly xOnly: Buffer;
  private constructor(priv: Buffer) {
    const ECPair = ECPairFactory(ecc);
    this.key = ECPair.fromPrivateKey(priv);
    this.xOnly = Buffer.from(this.key.publicKey.subarray(1));
  }

  static load(path: string, expectedXOnlyHex?: string): FileGuardianCustodyBackend {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(`GUARDIAN_KEY_FILE ${path} is readable by group or others (mode ${mode.toString(8)}); chmod 600 it`);
    }
    const hex = readFileSync(path, "utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("GUARDIAN_KEY_FILE must hold exactly 64 hex characters");
    const priv = Buffer.from(hex, "hex");
    if (!ecc.isPrivate(priv)) throw new Error("GUARDIAN_KEY_FILE is not a valid secp256k1 private key");
    // ECPair keeps this buffer as the key, so it is not wiped here.
    const backend = new FileGuardianCustodyBackend(priv);
    if (expectedXOnlyHex !== undefined && backend.xOnly.toString("hex") !== expectedXOnlyHex.toLowerCase()) {
      throw new Error("GUARDIAN_KEY_FILE does not match the profile's guardianXOnly; refusing to sign for other vaults");
    }
    return backend;
  }

  async xOnlyPubkey(): Promise<Buffer> {
    return Buffer.from(this.xOnly);
  }
  async signTaprootScriptPath(params: { sighash: Buffer; leafTapleafHash: Buffer }): Promise<Buffer> {
    return Buffer.from(ecc.signSchnorr(params.sighash, this.key.privateKey!));
  }
}

/** Fail-closed production backend until the operator selects real custody. */
export class UnconfiguredGuardianCustodyBackend implements GuardianCustodyBackend {
  async xOnlyPubkey(): Promise<Buffer> {
    throw new Error("CUSTODY_BACKEND_NOT_CONFIGURED: no production custody backend selected");
  }
  async signTaprootScriptPath(_params: { sighash: Buffer; leafTapleafHash: Buffer }): Promise<Buffer> {
    throw new Error("CUSTODY_BACKEND_NOT_CONFIGURED: no production custody backend selected");
  }
}

/**
 * Sign a vault execution leaf (MINT or REDEEM) via a custody backend: compute the
 * exact BIP341 sighash, request the signature from the backend, INDEPENDENTLY
 * verify it against the backend's x-only key, then commit the final witness.
 * Throws on any mismatch (never commits an unverified signature).
 */
export async function signVaultExecutionLeafWithCustody(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  leaf: VaultLeafRef,
  controlBlock: Buffer,
  backend: GuardianCustodyBackend,
): Promise<Buffer> {
  const sighash = computeVaultExecutionSighash(psbt, inputIndex, leaf);
  const sig = await backend.signTaprootScriptPath({ sighash, leafTapleafHash: leaf.tapleafHash });
  const xOnly = await backend.xOnlyPubkey();
  verifyVaultExecutionSignature(psbt, inputIndex, leaf, sig, xOnly);
  commitVaultExecutionWitness(psbt, inputIndex, leaf, controlBlock, sig);
  return sig;
}

/**
 * The pluggable signing primitive used by the transition signer. The LOCAL path
 * uses `GuardianV3Signer`; the Guardian SERVICE path uses a custody backend.
 */
export interface GuardianSigningBackend {
  xOnlyPubkey(): Promise<Buffer>;
  signVaultExecutionLeaf(psbt: bitcoin.Psbt, inputIndex: number, leaf: VaultLeafRef, controlBlock: Buffer): Promise<Buffer>;
}

/** Wrap the in-process local signer as an async signing backend. */
export function localSigningBackend(signer: GuardianV3Signer): GuardianSigningBackend {
  return {
    xOnlyPubkey: async () => signer.xOnlyPubkey(),
    signVaultExecutionLeaf: async (psbt, inputIndex, leaf, controlBlock) => signer.signVaultExecutionLeaf(psbt, inputIndex, leaf, controlBlock),
  };
}

/** Wrap a custody backend as an async signing backend (independent verify). */
export function custodySigningBackend(backend: GuardianCustodyBackend): GuardianSigningBackend {
  return {
    xOnlyPubkey: () => backend.xOnlyPubkey(),
    signVaultExecutionLeaf: (psbt, inputIndex, leaf, controlBlock) => signVaultExecutionLeafWithCustody(psbt, inputIndex, leaf, controlBlock, backend),
  };
}
