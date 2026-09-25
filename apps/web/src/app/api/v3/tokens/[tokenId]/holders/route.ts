import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const limited = checkRateLimit(req, "read-holders");
    if (limited) return limited;
    const { app } = getV3Services();
    const { tokenId } = await params;
    return ok(await app.tokenHolders(tokenId, 100));
  } catch (e) {
    return handleError(e);
  }
}
