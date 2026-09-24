import { ok, handleError } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const { app } = assertV3Enabled();
    const { fillId } = await params;
    const result = await app.finalizeAndBroadcastFill(fillId);
    return ok({ fillId, ...result });
  } catch (e) {
    return handleError(e);
  }
}
