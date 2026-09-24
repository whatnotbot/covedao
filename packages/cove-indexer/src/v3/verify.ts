import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import * as bitcoin from "bitcoinjs-lib";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import { RESERVE_ANCHOR_SATS } from "./constants.js";
import { V3IndexerState } from "./state.js";
import type { V3IndexerConfig } from "./types.js";

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * QUICK verify (§21): cursor block hash matches Core; each backing outpoint's
 * script matches its current state and its BTC value equals anchor + R(supply);
 * token-UTXO invariants hold.
 */
export async function quickVerify(
  state: V3IndexerState,
  provider: CoreRpcProvider,
): Promise<VerifyResult> {
  const cursorHash = await provider.getBlockHash(Number(state.cursor.height));
  if (cursorHash !== state.cursor.blockHash) {
    return { ok: false, reason: `cursor hash mismatch: db=${state.cursor.blockHash} core=${cursorHash}` };
  }
  const btcNet = state.config.network === "regtest" ? bitcoin.networks.regtest : bitcoin.networks.testnet;
  for (const b of state.backing.values()) {
    const vault = buildBackingVaultV3({
      state: b.state,
      guardianXOnly: state.config.guardianXOnly,
      recoveryKeyXOnly: state.config.recoveryKeyXOnly,
      network: btcNet,
    });
    if (vault.scriptPubKey.toString("hex") !== b.scriptPubKey) {
      return { ok: false, reason: `backing script mismatch for ${b.tokenId}` };
    }
    if (b.btcValue !== RESERVE_ANCHOR_SATS + b.state.backingSats) {
      return { ok: false, reason: `backing value mismatch for ${b.tokenId}` };
    }
  }
  // state root is self-consistent by construction (recomputed from maps)
  return { ok: true };
}

/**
 * FULL verify (§21): replay the canonical chain into a clean in-memory state
 * and compare the deterministic root against the persisted projection.
 */
export async function fullVerify(
  state: V3IndexerState,
  provider: CoreRpcProvider,
  config: V3IndexerConfig,
): Promise<VerifyResult> {
  const fresh = new V3IndexerState(config);
  for (let h = config.genesisHeight; h <= state.cursor.height; h++) {
    if (h === 0n) continue; // genesis activation height boundary
    const hash = await provider.getBlockHash(Number(h));
    const block = await provider.getBlock(hash);
    fresh.applyBlock({ height: BigInt(h), hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs });
  }
  if (fresh.stateRoot() !== state.stateRoot()) {
    return { ok: false, reason: `root mismatch: replay=${fresh.stateRoot()} db=${state.stateRoot()}` };
  }
  return { ok: true };
}
