import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const { app } = getV3Services();
    const { tokenId } = await params;
    return ok(await app.tokenHolders(tokenId, 100));
  } catch (e) {
    return handleError(e);
  }
}
