import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { app } = getV3Services();
    const body = await readJson(req);
    return ok(await app.quoteRedeem(strField(body, "tokenId"), bigintField(body, "amountAtoms", 0n)));
  } catch (e) {
    return handleError(e);
  }
}
