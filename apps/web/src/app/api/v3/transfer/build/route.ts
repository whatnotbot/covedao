import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(req, "build-transfer");
    if (limited) return limited;
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const result = await app.buildTransfer({
      tokenId: strField(body, "tokenId"),
      amountAtoms: bigintField(body, "amountAtoms", 0n),
      recipientScript: strField(body, "recipientScript"),
      walletScript: strField(body, "walletScript"),
      walletAddress: strField(body, "walletAddress") || null,
      funding: (body.funding ?? []) as { txid: string; vout: number }[],
      minerFeeSats: bigintField(body, "minerFeeSats", 1000n),
      idempotencyKey: strField(body, "idempotencyKey") || `transfer-${Date.now()}`,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
