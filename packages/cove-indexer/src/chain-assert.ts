import type { BitcoinChainProvider } from "@crclaunch/bitcoin";

/**
 * Genesis block hash of the Bitcoin signet. Every signet (default signet and
 * custom signets such as Mutinynet) shares this same genesis block, so this
 * assertion distinguishes the signet family from mainnet/testnet/regtest — but
 * NOT one signet from another (they all report the same chain string and the
 * same genesis). Distinguishing two signets requires the signet challenge,
 * which is out of scope here.
 */
export const SIGNET_GENESIS_HASH = "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6";

/** Bitcoin mainnet genesis block hash. */
export const MAINNET_GENESIS_HASH = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

export function isSignetGenesis(hash: string): boolean {
  return hash.toLowerCase() === SIGNET_GENESIS_HASH;
}

export function isMainnetGenesis(hash: string): boolean {
  return hash.toLowerCase() === MAINNET_GENESIS_HASH;
}

/**
 * A-8: the activation height H must be a FUTURE block height at the moment it
 * is committed. The owner runs this (with the live mainnet tip) BEFORE
 * committing H into COVE_V1_MAINNET_CONFIG; a past height is rejected so a
 * wrong H can never trigger a multi-hundred-thousand-block replay.
 */
export function assertFutureActivationHeight(H: number, currentTip: number): void {
  if (!Number.isInteger(H) || H < 1) {
    throw new Error(`activation height must be a positive integer, got ${H}`);
  }
  if (H <= currentTip) {
    throw new Error(`activation height ${H} must be in the future (current tip ${currentTip})`);
  }
}

/**
 * Refuse to index/broadcast unless the provider's genesis block is signet.
 * Prevents a misconfigured URL from silently pointing the proof at mainnet or
 * testnet (the dangerous case). Complements, not replaces, `chain === "signet"`.
 */
export async function assertSignetChain(provider: Pick<BitcoinChainProvider, "getBlockHash">): Promise<void> {
  const genesis = await provider.getBlockHash(0);
  if (!isSignetGenesis(genesis)) {
    throw new Error(
      `genesis block hash ${genesis} is not signet (${SIGNET_GENESIS_HASH}); refusing to proceed on a non-signet chain`,
    );
  }
}

/**
 * Refuse to broadcast unless the Core provider is on Bitcoin mainnet. This runs
 * on the SAME host that will broadcast, so a misconfigured RPC URL (testnet,
 * signet, or a hostile node) cannot be used to send the canary to the wrong
 * chain.
 */
export async function assertMainnetChain(provider: Pick<BitcoinChainProvider, "getBlockHash">): Promise<void> {
  const genesis = await provider.getBlockHash(0);
  if (!isMainnetGenesis(genesis)) {
    throw new Error(
      `genesis block hash ${genesis} is not mainnet (${MAINNET_GENESIS_HASH}); refusing to broadcast`,
    );
  }
}
