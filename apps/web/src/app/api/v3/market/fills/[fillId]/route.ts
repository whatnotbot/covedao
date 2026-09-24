import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ fillId: string }> }) {
  try {
    const { app } = getV3Services();
    const { fillId } = await params;
    const rows = await app.getFill(fillId);
    if (rows.length === 0) return ok(null);
    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
