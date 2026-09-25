import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const limited = checkRateLimit(req, "read-fill");
    if (limited) return limited;
    const { app } = getV3Services();
    const { fillId } = await params;
    const rows = await app.getFill(fillId);
    if (rows.length === 0) return ok(null);
    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
