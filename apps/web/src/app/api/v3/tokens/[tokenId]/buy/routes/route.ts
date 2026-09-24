import { ok, handleError, readJson, bigintField } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const { app } = getV3Services();
    const { tokenId } = await params;
    const body = await readJson(req);
    return ok(await app.getBuyRoutes(tokenId, bigintField(body, "amountAtoms", 0n)));
  } catch (e) {
    return handleError(e);
  }
}
