import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import {
  deriveStateOutput,
  stateCommitment,
  stateHash,
  stateTweak,
} from "@crclaunch/cove-covenant";
import type { Atoms, Sats } from "@crclaunch/curve";
import { GuardianError, type GuardianNetwork } from "./policy.js";
import {
  analyzeMintTx,
  resolveAllInputs,
  unsignedTransaction,
  validateMintTx,
  type MintIntent,
  type MintTxAnalysis,
} from "./tx.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function networkByte(n: GuardianNetwork): number {
  switch (n) {
    case "mainnet":
      return 0x00;
    case "signet":
      return 0x01;
    case "regtest":
      return 0x02;
    case "testnet":
      return 0x03;
  }
}

function u64BE(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(value, 0);
  return b;
}

export interface MintAuditRecord {
  prevStateHash: string;
  nextStateHash: string;
  amountAtoms: Atoms;
  curveContributionSats: Sats;
  platformFeeSats: Sats;
  minerFeeSats: Sats;
  recipientCommitment: Buffer;
  /** txid (32 bytes) of the UNSIGNED transaction being authorized. */
  txId: Buffer;
  network: GuardianNetwork;
}

/**
 * AUDIT-ONLY digest. It is NOT the authorization that secures the Bitcoin UTXO
 * — that is the BIP341 key-path signature over the transaction sighash produced
 * by `signMintTx`. This digest exists only for off-chain audit logging.
 */
export function auditDigest(rec: MintAuditRecord): Buffer {
  const h = createHash("sha256");
  h.update("Cove/GuardianAudit/v1", "utf8");
  h.update(Buffer.from([0x00]));
  h.update(Buffer.from(rec.prevStateHash, "hex"));
  h.update(Buffer.from(rec.nextStateHash, "hex"));
  h.update(u64BE(rec.amountAtoms));
  h.update(u64BE(rec.curveContributionSats));
  h.update(u64BE(rec.platformFeeSats));
  h.update(u64BE(rec.minerFeeSats));
  h.update(rec.recipientCommitment);
  h.update(rec.txId);
  h.update(Buffer.from([networkByte(rec.network)]));
  return h.digest();
}

export interface SignedMintResult {
  psbt: bitcoin.Psbt;
  /** The 64/65-byte BIP340 key-path signature over the transaction sighash. */
  tapKeySig: Buffer;
  /** The exact BIP341 key-path sighash that was signed (SIGHASH_DEFAULT). */
  sighash: Buffer;
  analysis: MintTxAnalysis;
  /** Audit-only digest (never mistaken for the Bitcoin authorization). */
  auditDigest: Buffer;
  /** Audit-only signature by the internal key P (never used for the UTXO). */
  auditSignature: Buffer;
}

/**
 * The Guardian signer, bound to the ACTUAL Bitcoin spend.
 *
 * The ONLY method that produces a Bitcoin signature is `signMintTx`, which
 * first validates the real PSBT (`validateMintTx`) and then — and only then —
 * derives the tweaked key internally and signs the exact BIP341 sighash. There
 * is deliberately NO public path that takes the WIF or a tweaked key and signs
 * a Cove state input without policy validation.
 */
export class TaprootGuardianSigner {
  /** The covenant internal key P (32-byte x-only). */
  readonly internalKey: Buffer;
  private readonly keyPair: ReturnType<typeof ECPair.fromWIF>;
  private readonly network: GuardianNetwork;

  constructor(wif: string, network: GuardianNetwork = "regtest") {
    this.network = network;
    const net = network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.regtest;
    this.keyPair = ECPair.fromWIF(wif, net);
    this.internalKey = Buffer.from(this.keyPair.publicKey.subarray(1));
  }

  /**
   * Validate the REAL transaction, then sign its exact BIP341 sighash.
   *
   * Throws `GuardianError(POLICY_REJECTED)` WITHOUT deriving or touching the
   * tweaked key if any policy check fails.
   */
  signMintTx(psbt: bitcoin.Psbt, intent: MintIntent): SignedMintResult {
    // 1. Bind policy to the actual transaction (every input/output/amount/fee).
    const decision = validateMintTx(psbt, this.internalKey, intent, this.network);
    if (!decision.ok) {
      throw new GuardianError("POLICY_REJECTED", decision.reason ?? "rejected");
    }
    const analysis = analyzeMintTx(psbt, this.internalKey, intent, this.network);
    const stateInputIndex = analysis.stateInputIndex;

    // 2. Derive the tweaked key internally. Q(prevState) = P + t·G.
    const tweak = stateTweak(this.internalKey, intent.prevState);
    const tweakedKey = this.keyPair.tweak(tweak);

    // 3. Ensure the state input carries the covenant taproot commitment.
    psbt.updateInput(stateInputIndex, {
      tapInternalKey: this.internalKey,
      tapMerkleRoot: stateCommitment(intent.prevState),
    });

    // 4. Sign the exact BIP341 key-path sighash.
    psbt.signTaprootInput(stateInputIndex, tweakedKey);

    // 5. Independently verify the signature we just produced (defense in depth).
    const inputs = resolveAllInputs(psbt);
    const unsigned = unsignedTransaction(psbt);
    const sighash = unsigned.hashForWitnessV1(
      stateInputIndex,
      inputs.map((i) => i.script),
      inputs.map((i) => Number(i.valueSats)),
      bitcoin.Transaction.SIGHASH_DEFAULT,
    );
    const q0 = deriveStateOutput(this.internalKey, intent.prevState).outputKey;
    const tapKeySig = Buffer.from(psbt.data.inputs[stateInputIndex]!.tapKeySig!);
    const sigOk = ecc.verifySchnorr(sighash, q0, tapKeySig.subarray(0, 64));
    if (!sigOk) {
      throw new GuardianError("SIGN_FAILED", "produced key-path signature failed to verify");
    }

    // 6. Produce the AUDIT-ONLY digest + signature (internal key P, distinct).
    const rec: MintAuditRecord = {
      prevStateHash: stateHash(intent.prevState),
      nextStateHash: stateHash(analysis.nextState),
      amountAtoms: intent.amountAtoms,
      curveContributionSats: analysis.curveContributionSats,
      platformFeeSats: analysis.platformFeeSats,
      minerFeeSats: analysis.minerFeeSats,
      recipientCommitment: intent.recipientCommitment,
      txId: unsigned.getHash(),
      network: this.network,
    };
    const digest = auditDigest(rec);
    const auditSignature = Buffer.from(this.keyPair.signSchnorr(digest));

    return { psbt, tapKeySig, sighash, analysis, auditDigest: digest, auditSignature };
  }

  /** Verify an AUDIT-ONLY signature against the internal key P. */
  verifyAuditSignature(digest: Buffer, signature: Buffer): boolean {
    return ecc.verifySchnorr(digest, this.internalKey, signature);
  }
}
