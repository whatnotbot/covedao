import { fail, json } from "@/lib/api";
import type { Database } from "@crclaunch/db";
import {
  createChainTx,
  forceSetChainTxStatus,
  getChainTxByTxid,
  insertMint,
  insertListing,
  getTokenByDeployment,
  setTokenStatus,
} from "@crclaunch/db";
import type { CRCProtocolAdapter } from "@crclaunch/protocol";
import type { RuntimeConfig } from "@crclaunch/config";

export interface BroadcastRequest {
  signedPsbt: string;
  walletAddress: string;
  operation: "DEPLOY" | "MINT" | "DEX_ASK" | "DEX_BID" | "DEX_CANCEL";
}

export async function broadcastOperation(
  db: Database,
  adapter: CRCProtocolAdapter,
  config: RuntimeConfig,
  req: BroadcastRequest,
): Promise<Response> {
  // Derive canonical operation/signer/txid from the SIGNED TRANSACTION itself —
  // never trust the client's claimed `operation`.
  let decoded;
  try {
    decoded = await adapter.decodeSignedTransaction(req.signedPsbt);
  } catch (e) {
    return fail("TX_REJECTED", e instanceof Error ? e.message : "Could not decode transaction.", 400);
  }

  if (!decoded.signer) {
    return fail("WALLET_NOT_CONNECTED", "Transaction is not signed.", 400);
  }
  if (decoded.signer !== req.walletAddress) {
    return fail("NETWORK_MISMATCH", "Signer address does not match connected wallet.", 400);
  }
  if (decoded.operation !== req.operation) {
    return fail("TX_REJECTED", "Transaction operation mismatch.", 400);
  }

  const txid = await adapter.broadcast(req.signedPsbt);

  let chainTx = await getChainTxByTxid(db, config.network, txid);
  if (!chainTx) {
    chainTx = await createChainTx(db, {
      network: config.network,
      operation: decoded.operation,
      walletAddress: req.walletAddress,
      idempotencyKey: `broadcast-${txid}`,
      txid,
      status: "BROADCAST",
      deploymentId: null,
    });
  }
  const deploymentId = chainTx?.deploymentId ?? null;

  if (chainTx) {
    await forceSetChainTxStatus(db, chainTx.id, "MEMPOOL");
  }

  // Optimistic UI bookkeeping only — the canonical indexer is authoritative and
  // re-syncs real values from validated chain events.
  if (decoded.operation === "DEPLOY") {
    const token = await getTokenByDeployment(db, config.network, txid);
    if (token) {
      await stepToken(db, token.id, token.status as never, "DEPLOY_BROADCAST");
      await stepToken(db, token.id, "DEPLOY_BROADCAST", "DEPLOY_PENDING");
    }
  } else if (decoded.operation === "MINT") {
    await insertMint(db, {
      network: config.network,
      deploymentId: deploymentId ?? "",
      walletAddress: req.walletAddress,
      tokenAmountAtoms: 0n,
      curveContributionSats: 0n,
      platformFeeSats: 0n,
      minerFeeSats: 0n,
      txid,
      status: "MEMPOOL",
    });
  } else if (decoded.operation === "DEX_ASK") {
    await insertListing(db, {
      listingId: txid,
      network: config.network,
      deploymentId: deploymentId ?? "",
      sellerAddress: req.walletAddress,
      tokenAmountAtoms: 0n,
      askingPriceSats: 0n,
      creationHeight: 0n,
      expiryHeight: 0n,
      status: "BROADCAST",
      txid,
    });
  }

  return json({ ok: true, data: { txid } });
}

async function stepToken(db: Database, id: string, from: string, to: string) {
  try {
    await setTokenStatus(db, id, from as never, to as never);
  } catch {
    // Already advanced; ignore.
  }
}
