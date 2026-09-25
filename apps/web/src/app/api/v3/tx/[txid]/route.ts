import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ txid: string }> }) {
  try {
    const limited = checkRateLimit(req, "read-tx");
    if (limited) return limited;
    const { app } = getV3Services();
    const { txid } = await params;
    return ok(await app.txStatus(txid));
  } catch (e) {
    return handleError(e);
  }
}
