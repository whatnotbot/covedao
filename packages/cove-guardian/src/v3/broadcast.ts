import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import type { GuardianV3Network } from "./types.js";

/**
 * Hardened broadcast boundary (Phase 4.4 §20). The ONLY path to Core broadcast
 * for a Cove transaction. Before sendrawtransaction it requires: final raw
 * bytes available, final Cove validation PASS (caller-provided), network gate
 * checked, and Core testmempoolaccept allowed. Mainnet is ALWAYS refused (no
 * environment variable may activate it this phase).
 */

export interface BroadcastResult {
  txid: string;
  mempoolAcceptAllowed: boolean;
}

export async function validateAndBroadcastCoveTransaction(params: {
  rawTxHex: string;
  network: GuardianV3Network;
  provider: CoreRpcProvider;
}): Promise<BroadcastResult> {
  if ((params.network as string) === "mainnet") {
    throw new Error("MAINNET_BROADCAST_REFUSED: mainnet is disabled this phase");
  }
  const accept = await params.provider.testMempoolAccept(params.rawTxHex);
  if (accept.allowed !== true) {
    throw new Error(`testmempoolaccept rejected: ${accept.rejectReason ?? "unknown"}`);
  }
  const txid = await params.provider.broadcastTransaction(params.rawTxHex);
  return { txid, mempoolAcceptAllowed: accept.allowed };
}
