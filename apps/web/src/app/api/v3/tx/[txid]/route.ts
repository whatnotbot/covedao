import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ txid: string }> }) {
  try {
    const { app } = getV3Services();
    const { txid } = await params;
    return ok(await app.txStatus(txid));
  } catch (e) {
    return handleError(e);
  }
}
