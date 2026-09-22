import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { mintBuildSchema } from "@crclaunch/schemas";
import { getQuote, getTokenByDeployment, createChainTx } from "@crclaunch/db";
import { quoteExactTokens, computePlatformFee } from "@crclaunch/curve";
import { treasuryAddress } from "@/lib/treasury";
import { randomUUID } from "node:crypto";

export async function POST(req: Request) {
  const { db, adapter, config } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = mintBuildSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  const { quoteId, walletAddress } = parsed.data;
  const idempotencyKey = req.headers.get("idempotency-key") ?? randomUUID();

  try {
    const quote = await getQuote(db, quoteId);
    if (!quote) return fail("QUOTE_EXPIRED", "Quote not found. Request a new quote.", 404, true);

    // Quote ownership: the wallet that requested the quote must build it.
    if (quote.walletAddress !== walletAddress) {
      return fail("WALLET_NOT_CONNECTED", "Quote does not belong to this wallet.", 403);
    }

    // Expiration by wall clock.
    if (new Date(quote.expiresAt).getTime() < Date.now()) {
      return fail("QUOTE_EXPIRED", "The mint price changed. Request a new quote.", 400, true);
    }

    // Expiration by block height.
    const currentHeight = await adapter.getCurrentHeight();
    if (currentHeight >= quote.expiresAtHeight) {
      return fail("QUOTE_EXPIRED", "Quote expired by block height. Request a new quote.", 400, true);
    }

    // Fresh state hash.
    const stateHash = await adapter.getStateHash();
    if (stateHash !== quote.stateHash) {
      return fail("QUOTE_EXPIRED", "The mint price changed. Request a new quote.", 400, true);
    }

    const token = await getTokenByDeployment(db, config.network, quote.deploymentId);
    if (!token) return fail("NOT_FOUND", "Token not found.", 404);

    // Canonical/current confirmed supply must equal the quote's snapshot.
    if (token.confirmedMintedAtoms !== quote.supplyBeforeAtoms) {
      return fail("SUPPLY_CHANGED", "Minted supply changed; refresh your quote.", 409, true);
    }

    // Token must still be live.
    if (token.status !== "LIVE") {
      return fail("MINT_SOLD_OUT", "Public mint is not live.", 409);
    }

    // Recalculate the quote deterministically — never trust the stored values.
    const recalculated = quoteExactTokens({
      desiredTokens: quote.tokensAtoms,
      currentSupply: quote.supplyBeforeAtoms,
    });
    if (
      recalculated.curveContributionSats !== quote.curveContributionSats ||
      recalculated.startingStage !== quote.startingStage ||
      recalculated.endingStage !== quote.endingStage ||
      recalculated.supplyAfter !== quote.supplyAfterAtoms
    ) {
      return fail("QUOTE_EXPIRED", "Quote data is inconsistent. Request a new quote.", 409, true);
    }

    // Recalculate platform fee (server-derived, never trusted).
    const platformFee = computePlatformFee(quote.curveContributionSats, config.primaryMintFeeBps);
    if (platformFee !== quote.platformFeeSats) {
      return fail("QUOTE_EXPIRED", "Quote fee is inconsistent. Request a new quote.", 409, true);
    }

    // Server-side fee protection (do not rely on disabled UI buttons).
    const minerFee = quote.estimatedMinerFeeSats;
    if (quote.curveContributionSats > 0n && minerFee * 100n > quote.curveContributionSats * 50n) {
      return fail("TX_FEE_TOO_HIGH", "Network fee exceeds 50% of contribution.", 400);
    }

    const unsigned = await adapter.buildMint({
      deploymentId: quote.deploymentId,
      ticker: token.ticker,
      buyerAddress: walletAddress,
      treasuryAddress: treasuryAddress(config),
      tokenAmountAtoms: recalculated.tokens,
      curveContributionSats: recalculated.curveContributionSats,
      platformFeeSats: platformFee,
      minerFeeSats: minerFee,
      currentSupplyAtoms: quote.supplyBeforeAtoms,
      stateHash: quote.stateHash,
    });

    await createChainTx(db, {
      network: config.network,
      operation: "MINT",
      walletAddress,
      idempotencyKey,
      txid: unsigned.psbtBase64 ? extractTxid(unsigned.psbtBase64) : null,
      status: "AWAITING_SIGNATURE",
      deploymentId: quote.deploymentId,
      payloadJson: unsigned,
    });

    return ok({ unsignedTx: unsigned });
  } catch (e) {
    return handleError(e);
  }
}

function extractTxid(psbtBase64: string): string {
  const json = Buffer.from(psbtBase64, "base64").toString("utf8");
  const parsed = JSON.parse(json) as { txid?: string };
  return parsed.txid ?? "";
}
