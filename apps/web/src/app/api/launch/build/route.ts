import { randomUUID } from "node:crypto";
import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { launchBuildSchema } from "@crclaunch/schemas";
import {
  createChainTx,
  getChainTxByIdempotency,
  getTokenByTicker,
  insertDraftToken,
  upsertTokenMetadata,
} from "@crclaunch/db";
import { TOTAL_SUPPLY_TOKENS, PUBLIC_SUPPLY_TOKENS, GRADUATION_RESERVE_TOKENS } from "@crclaunch/curve";
import { treasuryAddress } from "@/lib/treasury";

export async function POST(req: Request) {
  const { db, adapter, config } = getServices();
  await initServices();
  const idempotencyKey = req.headers.get("idempotency-key") ?? randomUUID();
  const body = await readJson(req);
  const parsed = launchBuildSchema.safeParse(body);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  }
  const { walletAddress, ticker, name, description, websiteUrl, xUrl, termsVersion } = parsed.data;

  try {
    // Idempotent replay.
    const existing = await getChainTxByIdempotency(db, walletAddress, "DEPLOY", idempotencyKey);
    if (existing?.payloadJson) {
      return ok({
        chainTxId: existing.id,
        deploymentId: existing.deploymentId,
        txid: existing.txid,
        unsignedTx: existing.payloadJson,
        replayed: true,
      });
    }

    // Fresh protocol re-check immediately before construction.
    const onChain = await adapter.getTokenByTicker(ticker);
    if (onChain) return fail("TICKER_TAKEN", `Ticker ${ticker} is already taken on-chain.`, 409);
    const local = await getTokenByTicker(db, config.network, ticker);
    if (local) return fail("TICKER_TAKEN", `Ticker ${ticker} is already taken.`, 409);

    const unsigned = await adapter.buildDeploy({
      ticker,
      name,
      creatorAddress: walletAddress,
      treasuryAddress: treasuryAddress(config),
      launchFeeSats: config.launchFeeSats,
      network: config.network,
    });

    // Persist chain tx + token + metadata.
    const txid = unsigned.psbtBase64 ? extractTxid(unsigned.psbtBase64) : undefined;
    const chainTx = await createChainTx(db, {
      network: config.network,
      operation: "DEPLOY",
      walletAddress,
      idempotencyKey,
      txid,
      status: "AWAITING_SIGNATURE",
      deploymentId: txid,
      payloadJson: unsigned,
    });
    if (!chainTx) {
      // Race: another request with the same key won; return it.
      const winner = await getChainTxByIdempotency(db, walletAddress, "DEPLOY", idempotencyKey);
      if (winner?.payloadJson) {
        return ok({
          chainTxId: winner.id,
          deploymentId: winner.deploymentId,
          txid: winner.txid,
          unsignedTx: winner.payloadJson,
          replayed: true,
        });
      }
      return fail("IDEMPOTENCY_CONFLICT", "Request already in flight.", 409, true);
    }

    const token = await insertDraftToken(db, {
      deploymentTxid: txid ?? `pending-${chainTx.id}`,
      ticker,
      tickerNormalized: ticker,
      name,
      creatorAddress: walletAddress,
      network: config.network,
      status: "DEPLOY_AWAITING_SIGNATURE",
      totalSupplyAtoms: TOTAL_SUPPLY_TOKENS,
      publicSupplyAtoms: PUBLIC_SUPPLY_TOKENS,
      reserveSupplyAtoms: GRADUATION_RESERVE_TOKENS,
    });
    await upsertTokenMetadata(db, token.deploymentTxid, {
      description,
      websiteUrl: websiteUrl || null,
      xUrl: xUrl || null,
      termsVersion,
      termsWalletAddress: walletAddress,
    });

    return ok({
      chainTxId: chainTx.id,
      deploymentId: txid,
      txid,
      unsignedTx: unsigned,
    });
  } catch (e) {
    return handleError(e);
  }
}

function extractTxid(psbtBase64: string): string {
  const json = Buffer.from(psbtBase64, "base64").toString("utf8");
  const parsed = JSON.parse(json) as { txid?: string };
  return parsed.txid ?? "";
}
