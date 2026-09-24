import { ok, handleError, readJson, strField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const result = await app.submitTransfer({ sessionId: strField(body, "sessionId"), signedPsbtBase64: strField(body, "signedPsbtBase64") });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
