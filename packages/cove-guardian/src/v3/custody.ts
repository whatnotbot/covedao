import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import {
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
