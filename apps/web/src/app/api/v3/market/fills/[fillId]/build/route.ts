import { ok, handleError, readJson, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const { app } = assertV3Enabled();
    const { fillId } = await params;
    const body = await readJson(req);
    const psbtBase64 = await app.buildFillPsbt(fillId, bigintField(body, "minerFeeSats", 1000n));
    return ok({ fillId, psbtBase64 });
  } catch (e) {
    return handleError(e);
  }
}
