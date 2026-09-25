import { ok, handleError, readJson, strField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { resolveFundingUtxos } from "@crclaunch/cove-app";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const limited = checkRateLimit(req, "reserve");
    if (limited) return limited;
    const { app, provider } = assertV3Enabled();
    const { listingId } = await params;
    const body = await readJson(req);
    const candidates = (body.funding ?? body.buyerFundInputs ?? []) as { txid: string; vout: number }[];
    const resolved = await resolveFundingUtxos(provider, candidates);
    const fillId = await app.reserveListing({
      listingId,
      buyerTokenScript: strField(body, "buyerTokenScript"),
      buyerChangeScript: strField(body, "buyerChangeScript"),
      buyerFundInputs: resolved.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script.toString("hex"), valueSats: f.valueSats })),
      buyerFundPublicKey: strField(body, "buyerFundPublicKey") || undefined,
      reserveNonce: strField(body, "nonceHex"),
      signatureB64: strField(body, "signatureB64"),
    });
    return ok({ fillId });
  } catch (e) {
    return handleError(e);
  }
}
