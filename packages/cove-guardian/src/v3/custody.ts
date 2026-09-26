import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import { isKnownTestPrivateKeyHex } from "@crclaunch/cove-mainnet";
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
 * Production custody from the environment: GUARDIAN_KEY_HEX, exactly 64 hex
 * characters. The Guardian signs every mint and redeem automatically, so this
 * is a hot key: set it only on the Guardian service, never on web or worker.
 *
 * The key stays inside this object: there is no method that returns it.
 * Loading refuses a malformed key and any of the repo's public test keys
 * (their private halves are in this repository).
 */
export class EnvGuardianCustodyBackend implements GuardianCustodyBackend {
  readonly #key: ECPairInterface;
  readonly #xOnly: Buffer;
  private constructor(priv: Buffer) {
    const ECPair = ECPairFactory(ecc);
    this.#key = ECPair.fromPrivateKey(priv);
    this.#xOnly = Buffer.from(this.#key.publicKey.subarray(1));
  }

  static fromHex(hex: string | undefined): EnvGuardianCustodyBackend {
    const h = (hex ?? "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("GUARDIAN_KEY_HEX must be exactly 64 hex characters");
    if (isKnownTestPrivateKeyHex(h)) throw new Error("GUARDIAN_KEY_HEX is one of the repo's public test keys; generate a real key");
    const priv = Buffer.from(h, "hex");
    if (!ecc.isPrivate(priv)) throw new Error("GUARDIAN_KEY_HEX is not a valid secp256k1 private key");
    return new EnvGuardianCustodyBackend(priv);
  }

  async xOnlyPubkey(): Promise<Buffer> {
    return Buffer.from(this.#xOnly);
  }
  async signTaprootScriptPath(params: { sighash: Buffer; leafTapleafHash: Buffer }): Promise<Buffer> {
    return Buffer.from(ecc.signSchnorr(params.sighash, this.#key.privateKey!));
  }
  /** Never print the key, even by accident. */
  toJSON(): string {
    return "[EnvGuardianCustodyBackend]";
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
