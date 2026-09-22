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
import { parseSignedMockPsbt, type CRCProtocolAdapter } from "@crclaunch/protocol";
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
  let envelope;
  try {
    const parsed = parseSignedMockPsbt(req.signedPsbt);
    envelope = parsed.envelope;
    if (!parsed.signer) return fail("WALLET_NOT_CONNECTED", "Transaction is not signed.", 400);
    if (parsed.signer !== req.walletAddress) {
      return fail("NETWORK_MISMATCH", "Signer address does not match connected wallet.", 400);
    }
  } catch {
    return fail("TX_REJECTED", "Could not parse signed transaction.", 400);
  }

  if (envelope.op !== req.operation) {
    return fail("TX_REJECTED", "Transaction operation mismatch.", 400);
  }

  let txid: string;
  try {
    txid = await adapter.broadcast(req.signedPsbt);
  } catch (e) {
    return fail("TX_REJECTED", e instanceof Error ? e.message : "Broadcast failed.", 502, true);
  }

  const idempotencyKey = `broadcast-${txid}`;
  let chainTx = await getChainTxByTxid(db, config.network, txid);
  if (!chainTx) {
    chainTx = await createChainTx(db, {
      network: config.network,
      operation: req.operation,
      walletAddress: req.walletAddress,
      idempotencyKey,
      txid,
      status: "BROADCAST",
      deploymentId: envelope.payload.deploymentId ?? null,
    });
  }

  if (chainTx) {
    await forceSetChainTxStatus(db, chainTx.id, "MEMPOOL");
  }

  // Operation-specific optimistic state (chain remains authoritative).
  if (req.operation === "DEPLOY") {
    const token = await getTokenByDeployment(db, config.network, txid);
    if (token) {
      await stepToken(db, token.id, token.status as never, "DEPLOY_BROADCAST");
      await stepToken(db, token.id, "DEPLOY_BROADCAST", "DEPLOY_PENDING");
    }
  } else if (req.operation === "MINT") {
    await insertMint(db, {
      network: config.network,
      deploymentId: envelope.payload.deploymentId ?? "",
      walletAddress: req.walletAddress,
      tokenAmountAtoms: envelope.payload.tokenAmountAtoms ?? 0n,
      curveContributionSats: envelope.payload.curveContributionSats ?? 0n,
      platformFeeSats: envelope.payload.platformFeeSats ?? 0n,
      minerFeeSats: envelope.payload.minerFeeSats ?? 0n,
      txid,
      status: "MEMPOOL",
    });
  } else if (req.operation === "DEX_ASK") {
    await insertListing(db, {
      listingId: txid,
      network: config.network,
      deploymentId: envelope.payload.deploymentId ?? "",
      sellerAddress: req.walletAddress,
      tokenAmountAtoms: envelope.payload.tokenAmountAtoms ?? 0n,
      askingPriceSats: envelope.payload.askingPriceSats ?? 0n,
      creationHeight: 0n,
      expiryHeight: envelope.payload.expiryHeight ?? 0n,
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
