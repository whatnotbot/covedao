import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import type { GuardianV3Network } from "./types.js";
import type { ValidatedCoveTransaction } from "./finalize.js";

/**
 * Hardened broadcast boundary (Phase 5 §1). The ONLY path to Core broadcast for
 * a Cove transaction, and it accepts ONLY an opaque `ValidatedCoveTransaction`
 * that the final validators produce — it is structurally impossible for
 * application code to hand it arbitrary unvalidated raw hex. testmempoolaccept
 * remains mandatory. On mainnet the node must report the main chain, so a
 * misconfigured RPC URL cannot send a mainnet transaction to the wrong node.
 */

export interface BroadcastResult {
  txid: string;
  mempoolAcceptAllowed: boolean;
}

export async function broadcastValidatedCoveTransaction(params: {
  validated: ValidatedCoveTransaction;
  network: GuardianV3Network;
  provider: CoreRpcProvider;
}): Promise<BroadcastResult> {
  if (params.network === "mainnet") {
    const chain = (await params.provider.getBlockchainInfo()).chain;
    if (chain !== "main") throw new Error(`WRONG_CHAIN: mainnet broadcast, but the node is on "${chain}"`);
  }
  const accept = await params.provider.testMempoolAccept(params.validated.rawTxHex);
  if (accept.allowed !== true) {
    throw new Error(`testmempoolaccept rejected: ${accept.rejectReason ?? "unknown"}`);
  }
  const txid = await params.provider.broadcastTransaction(params.validated.rawTxHex);
  if (txid !== params.validated.txid) {
    throw new Error(`TXID_MISMATCH: broadcast ${txid} != validated ${params.validated.txid}`);
  }
  return { txid, mempoolAcceptAllowed: accept.allowed };
}
