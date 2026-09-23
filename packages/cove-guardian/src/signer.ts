import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { stateHash } from "@crclaunch/cove-covenant";
import { validateMint, GuardianError, type GuardianNetwork, type MintContext } from "./policy.js";

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

/**
 * Canonical transition digest the Guardian signs. Commits to the exact previous
 * and successor state hashes, amounts, fee, recipient commitment and network —
 * so a signature cannot be replayed against a manipulated transition.
 */
export function transitionDigest(ctx: MintContext): Buffer {
  const h = createHash("sha256");
  h.update("Cove/GuardianAuth/v1", "utf8");
  h.update(Buffer.from([0x00]));
  h.update(Buffer.from(stateHash(ctx.prevState), "hex"));
  h.update(Buffer.from(stateHash(ctx.nextState), "hex"));
  h.update(u64BE(ctx.amountAtoms));
  h.update(u64BE(ctx.curveContributionSats));
  h.update(u64BE(ctx.feeSats));
  h.update(ctx.recipientCommitment);
  h.update(Buffer.from([networkByte(ctx.network)]));
  return h.digest();
}

export interface GuardianAuthorization {
  digest: Buffer;
  signature: Buffer; // 64-byte BIP340 Schnorr signature
}

/**
 * The Guardian signer. Key custody is deliberately a SEPARATE concern from the
 * policy engine: this class holds a key and will only ever use it after
 * `validateMint` passes. In production this key material lives in isolated
 * custody (Nitro Enclave / KMS); the policy engine is the only caller allowed
 * to request a signature.
 */
export class TaprootGuardianSigner {
  /** The covenant internal key P (32-byte x-only). */
  readonly internalKey: Buffer;
  private readonly keyPair: ReturnType<typeof ECPair.fromWIF>;

  constructor(wif: string, network: GuardianNetwork = "regtest") {
    const net = network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.regtest;
    this.keyPair = ECPair.fromWIF(wif, net);
    this.internalKey = Buffer.from(this.keyPair.publicKey.subarray(1));
  }

  /**
   * Authorize a MINT transition: validate the policy FIRST, then Schnorr-sign
   * the transition digest. Throws GuardianError(POLICY_REJECTED) without ever
   * touching the key if validation fails.
   */
  authorizeMint(ctx: MintContext): GuardianAuthorization {
    const decision = validateMint(ctx);
    if (!decision.ok) {
      throw new GuardianError("POLICY_REJECTED", decision.reason ?? "rejected");
    }
    const digest = transitionDigest(ctx);
    const signature = Buffer.from(this.keyPair.signSchnorr(digest));
    return { digest, signature };
  }

  /** Verify a produced authorization against the public internal key P. */
  verifyAuthorization(auth: GuardianAuthorization): boolean {
    return ecc.verifySchnorr(auth.digest, this.internalKey, auth.signature);
  }
}
