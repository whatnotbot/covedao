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

export function isSignetGenesis(hash: string): boolean {
  return hash.toLowerCase() === SIGNET_GENESIS_HASH;
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
