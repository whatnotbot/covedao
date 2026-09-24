import { ok, handleError, readJson, strField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const { app } = assertV3Enabled();
    const { fillId } = await params;
    const body = await readJson(req);
    await app.submitBuyerSignature(fillId, strField(body, "signedPsbtBase64"));
    return ok({ fillId, status: "BUYER_SIGNED" });
  } catch (e) {
    return handleError(e);
  }
}
