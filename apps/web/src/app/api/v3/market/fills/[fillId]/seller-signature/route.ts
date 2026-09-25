import { ok, handleError, readJson, strField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const limited = checkRateLimit(req, "seller-sign");
    if (limited) return limited;
    const { app } = assertV3Enabled();
    const { fillId } = await params;
    const body = await readJson(req);
    await app.submitSellerSignature(fillId, strField(body, "signedPsbtBase64"));
    return ok({ fillId, status: "SELLER_SIGNED" });
  } catch (e) {
    return handleError(e);
  }
}
