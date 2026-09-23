import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { numsInternalKey } from "./nums.js";
import { buildExecutionLeaf, buildRecoveryLeaf } from "./leaves.js";
import { LEAF_VERSION_TAPSCRIPT, tapBranchHash, tapleafHash, tweakKey } from "./taproot.js";

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
  /** The committed successor state hash (32 bytes) curried into the execution leaf. */
  successorStateHash: Buffer;
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
  const executionScript = buildExecutionLeaf(params.successorStateHash, params.guardianXOnly);
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
