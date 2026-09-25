import { randomBytes } from "node:crypto";
import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(req, "prepare-listing");
    if (limited) return limited;
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const nonceHex = strField(body, "nonceHex") || randomBytes(32).toString("hex");
    const result = await app.prepareListing({
      tokenId: strField(body, "tokenId"),
      sourceTxid: strField(body, "sourceTxid"),
      sourceVout: Number(bigintField(body, "sourceVout", 0n)),
      amountAtoms: bigintField(body, "amountAtoms", 0n),
      totalPriceSats: bigintField(body, "totalPriceSats", 0n),
      // A duration in blocks; the server resolves it against the real tip.
      expiryBlocks: bigintField(body, "expiryBlocks", 0n) || undefined,
      walletScript: strField(body, "walletScript"),
      nonceHex,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
