import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import type { CoveStateV2 } from "@crclaunch/cove-covenant";
import {
  buildBackingVaultV3,
  buildThresholdRecoveryWitness,
  sortRecoveryPubkeys,
  type VaultRecoveryProfile,
} from "@crclaunch/cove-vault";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

/**
 * OFFLINE emergency recovery tool (§8/§9). Reconstructs the exact production
 * vault from the committed profile + backing state, builds a recovery spend to
 * an APPROVED destination, enforces fee caps, and finalizes only after the
 * recovery threshold. NO automatic broadcast: broadcast is an explicit
 * `--broadcast` + human confirmation (the CLI), never a library default.
 */

export interface RecoverySpendInput {
  state: CoveStateV2;
  guardianXOnly: Buffer;
  recoveryProfile: VaultRecoveryProfile;
  /** The backing outpoint to recover. */
  outpoint: { txid: string; vout: number };
  vaultValueSats: bigint;
  /** Approved emergency destination scriptPubKey (recovery policy). */
  destinationScript: Buffer;
  minerFeeSats: bigint;
  maxMinerFeeSats: bigint;
  network?: bitcoin.networks.Network;
}

export interface RecoveryDraft {
  vault: ReturnType<typeof buildBackingVaultV3>;
  /** Raw unsigned transaction (no witness). */
  unsignedTx: bitcoin.Transaction;
  /** BIP341 tapscript sighash the recovery signers must sign. */
  sighash: Buffer;
  /** Signed keys so far (x-only hex → 64-byte Schnorr sig). */
  signatures: Map<string, Buffer>;
  /** The recovery public keys in deterministic order. */
  pubkeys: Buffer[];
  threshold: number;
}

export function buildRecoveryDraft(input: RecoverySpendInput): RecoveryDraft {
  if (input.minerFeeSats > input.maxMinerFeeSats) throw new Error("miner fee exceeds policy cap");
  if (input.minerFeeSats >= input.vaultValueSats) throw new Error("miner fee >= vault value");
  const vault = buildBackingVaultV3({
    state: input.state,
    guardianXOnly: input.guardianXOnly,
    recoveryKeyXOnly: input.recoveryProfile.recoveryPubkeys[0] ?? Buffer.alloc(32),
    network: input.network,
    recoveryProfile: input.recoveryProfile,
  });

  const tx = new bitcoin.Transaction();
  tx.version = 2;
  // nSequence = CSV blocks (disable flag clear), satisfying the recovery timelock.
  tx.addInput(Buffer.from(input.outpoint.txid, "hex").reverse(), input.outpoint.vout, input.recoveryProfile.recoveryCsvBlocks);
  const payout = input.vaultValueSats - input.minerFeeSats;
  tx.addOutput(input.destinationScript, Number(payout));

  const sighash = tx.hashForWitnessV1(
    0,
    [vault.scriptPubKey],
    [Number(input.vaultValueSats)],
    0x00, // SIGHASH_DEFAULT for tapscript
    vault.recoveryLeaf.tapleafHash,
  );

  return {
    vault,
    unsignedTx: tx,
    sighash: Buffer.from(sighash),
    signatures: new Map(),
    pubkeys: sortRecoveryPubkeys(input.recoveryProfile.recoveryPubkeys),
    threshold: input.recoveryProfile.recoveryThreshold,
  };
}

/** Sign the recovery sighash with one recovery private key (offline). */
export function signRecoverySighash(sighash: Buffer, privKeyHex: string): Buffer {
  const key = ECPair.fromPrivateKey(Buffer.from(privKeyHex, "hex"));
  return Buffer.from(ecc.signSchnorr(sighash, key.privateKey!));
}

/** Independently verify a recovery signature against a committed public key. */
export function verifyRecoverySignature(sighash: Buffer, xOnlyPubkey: Buffer, signature: Buffer): boolean {
  try {
    return ecc.verifySchnorr(sighash, xOnlyPubkey, signature);
  } catch {
    return false;
  }
}

/** Add one signature (verified against the committed key set). */
export function addRecoverySignature(draft: RecoveryDraft, xOnlyPubkey: Buffer, signature: Buffer): void {
  const found = draft.pubkeys.some((k) => k.equals(xOnlyPubkey));
  if (!found) throw new Error("signature key is not a committed recovery key");
  if (!verifyRecoverySignature(draft.sighash, xOnlyPubkey, signature)) throw new Error("invalid recovery signature");
  draft.signatures.set(xOnlyPubkey.toString("hex"), signature);
}

/** Finalize only when threshold is met; returns the raw transaction hex. */
export function finalizeRecovery(draft: RecoveryDraft): string {
  if (draft.signatures.size < draft.threshold) {
    throw new Error(`recovery threshold not met (${draft.signatures.size}/${draft.threshold})`);
  }
  const stack = buildThresholdRecoveryWitness({ pubkeys: draft.pubkeys, signatures: draft.signatures, threshold: draft.threshold });
  const witness = [...stack, draft.vault.recoveryLeaf.script, draft.vault.recoveryControlBlock];
  const tx = draft.unsignedTx;
  tx.setWitness(0, witness);
  return tx.toHex();
}
