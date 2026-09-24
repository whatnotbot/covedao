import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { numsInternalKey } from "./nums.js";
import { buildExecutionLeaf, buildRecoveryLeaf } from "./leaves.js";
import { buildRecoveryLeafForProfile, dev1RecoveryProfile, type VaultRecoveryProfile } from "./vaultProfile.js";
import {
  LEAF_VERSION_TAPSCRIPT,
  merklePaths,
  tapBranchHash,
  tapleafHash,
  taprootMerkleRoot,
  tweakKey,
} from "./taproot.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

export interface CoveVaultLeaf {
  script: Buffer;
  tapleafHash: Buffer;
}

export interface CoveVault {
  /** The NUMS internal key (no private key). */
  numsKey: Buffer;
  executionLeaf: CoveVaultLeaf;
  recoveryLeaf: CoveVaultLeaf;
  /** MAST merkle root (TapBranch hash of the two sorted tapleaf hashes). */
  merkleRoot: Buffer;
  /** Final x-only output key Q = NUMS + H_TapTweak(NUMS || merkleRoot)·G. */
  outputKey: Buffer;
  outputParity: number;
  /** P2TR scriptPubKey: 0x51 0x20 || Q. */
  scriptPubKey: Buffer;
  /** bech32m address. */
  address: string;
  /** Control block for the execution leaf (spend path). */
  executionControlBlock: Buffer;
  /** Control block for the recovery leaf (spend path). */
  recoveryControlBlock: Buffer;
}

export interface BuildCoveVaultParams {
  /** The policy identity hash (32 bytes) curried into the execution leaf. */
  policyIdentityHash: Buffer;
  /** Guardian x-only pubkey (32 bytes) for the execution leaf. */
  guardianXOnly: Buffer;
  /** Owner x-only pubkey (32 bytes) for the recovery leaf. */
  ownerXOnly: Buffer;
  network?: bitcoin.networks.Network;
}

/**
 * Build a Cove NUMS/dual-leaf vault. The output key is derived SOLELY from the
 * NUMS internal key and the committed Taproot tree — there is no key-path key.
 */
export function buildCoveVault(params: BuildCoveVaultParams): CoveVault {
  const numsKey = numsInternalKey();
  const executionScript = buildExecutionLeaf(params.policyIdentityHash, params.guardianXOnly);
  const recoveryScript = buildRecoveryLeaf(params.ownerXOnly);

  const executionTapleaf = tapleafHash(executionScript, LEAF_VERSION_TAPSCRIPT);
  const recoveryTapleaf = tapleafHash(recoveryScript, LEAF_VERSION_TAPSCRIPT);
  const merkleRoot = tapBranchHash(executionTapleaf, recoveryTapleaf);

  const { outputKey, parity } = tweakKey(numsKey, merkleRoot);

  // Control block = (leaf_version | parity) || internal_key || merkle_path.
  const controlBlockVersion = LEAF_VERSION_TAPSCRIPT | parity;
  const executionControlBlock = Buffer.concat([
    Buffer.from([controlBlockVersion]),
    numsKey,
    recoveryTapleaf, // sibling
  ]);
  const recoveryControlBlock = Buffer.concat([
    Buffer.from([controlBlockVersion]),
    numsKey,
    executionTapleaf, // sibling
  ]);

  const scriptPubKey = Buffer.concat([Buffer.from([0x51, 0x20]), outputKey]);
  const network = params.network ?? bitcoin.networks.regtest;
  const address = bitcoin.address.toBech32(outputKey, 1, network.bech32);

  return {
    numsKey,
    executionLeaf: { script: executionScript, tapleafHash: executionTapleaf },
    recoveryLeaf: { script: recoveryScript, tapleafHash: recoveryTapleaf },
    merkleRoot,
    outputKey,
    outputParity: parity,
    scriptPubKey,
    address,
    executionControlBlock,
    recoveryControlBlock,
  };
}

/**
 * Production V3 dual-op vault (§5): NUMS internal key + 3-leaf MAST
 * (MINT execution, REDEEM execution, RECOVERY). The output key commits which
 * policies/operations/token/state are authorized — NOT one future successor.
 */

export interface CoveVaultV3 {
  numsKey: Buffer;
  mintLeaf: CoveVaultLeaf;
  redeemLeaf: CoveVaultLeaf;
  recoveryLeaf: CoveVaultLeaf;
  merkleRoot: Buffer;
  outputKey: Buffer;
  outputParity: number;
  scriptPubKey: Buffer;
  address: string;
  mintControlBlock: Buffer;
  redeemControlBlock: Buffer;
  recoveryControlBlock: Buffer;
}

export interface BuildCoveVaultV3Params {
  /** MINT policy identity hash (32 bytes). */
  mintPolicyIdentityHash: Buffer;
  /** REDEEM policy identity hash (32 bytes). */
  redeemPolicyIdentityHash: Buffer;
  guardianXOnly: Buffer;
  ownerXOnly: Buffer;
  /** Versioned recovery profile; defaults to DEV1 (single key, 144 CSV). */
  recoveryProfile?: VaultRecoveryProfile;
  network?: bitcoin.networks.Network;
}

export function buildCoveVaultV3(params: BuildCoveVaultV3Params): CoveVaultV3 {
  const numsKey = numsInternalKey();
  const mintScript = buildExecutionLeaf(params.mintPolicyIdentityHash, params.guardianXOnly);
  const redeemScript = buildExecutionLeaf(params.redeemPolicyIdentityHash, params.guardianXOnly);
  const recoveryProfile = params.recoveryProfile ?? dev1RecoveryProfile(params.ownerXOnly);
  const recoveryScript = buildRecoveryLeafForProfile(recoveryProfile);

  const mintTapleaf = tapleafHash(mintScript, LEAF_VERSION_TAPSCRIPT);
  const redeemTapleaf = tapleafHash(redeemScript, LEAF_VERSION_TAPSCRIPT);
  const recoveryTapleaf = tapleafHash(recoveryScript, LEAF_VERSION_TAPSCRIPT);

  const merkleRoot = taprootMerkleRoot([mintTapleaf, redeemTapleaf, recoveryTapleaf]);
  const { outputKey, parity } = tweakKey(numsKey, merkleRoot);
  const paths = merklePaths([mintTapleaf, redeemTapleaf, recoveryTapleaf]);
  const versionByte = LEAF_VERSION_TAPSCRIPT | parity;

  const controlBlockFor = (tapleaf: Buffer): Buffer =>
    Buffer.concat([Buffer.from([versionByte]), numsKey, ...paths.get(tapleaf.toString("hex"))!]);

  const scriptPubKey = Buffer.concat([Buffer.from([0x51, 0x20]), outputKey]);
  const network = params.network ?? bitcoin.networks.regtest;
  const address = bitcoin.address.toBech32(outputKey, 1, network.bech32);

  return {
    numsKey,
    mintLeaf: { script: mintScript, tapleafHash: mintTapleaf },
    redeemLeaf: { script: redeemScript, tapleafHash: redeemTapleaf },
    recoveryLeaf: { script: recoveryScript, tapleafHash: recoveryTapleaf },
    merkleRoot,
    outputKey,
    outputParity: parity,
    scriptPubKey,
    address,
    mintControlBlock: controlBlockFor(mintTapleaf),
    redeemControlBlock: controlBlockFor(redeemTapleaf),
    recoveryControlBlock: controlBlockFor(recoveryTapleaf),
  };
}
