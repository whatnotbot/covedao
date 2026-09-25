import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(req, "build-buy");
    if (limited) return limited;
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const q = (body.quoteBinding ?? body.quote) as Record<string, unknown> | undefined;
    const outpoint = (q?.backingOutpoint ?? {}) as { txid?: string; vout?: number | string };
    const result = await app.buildBackingBuy({
      tokenId: strField(body, "tokenId"),
      amountAtoms: bigintField(body, "amountAtoms", 0n),
      quoteBinding: {
        stateHash: strField(q ?? {}, "stateHash"),
        backingOutpoint: { txid: String(outpoint.txid ?? ""), vout: Number(outpoint.vout ?? 0) },
        expiresAtHeight: bigintField(q ?? {}, "expiresAtHeight", 0n),
      },
      walletScript: strField(body, "walletScript"),
      walletAddress: strField(body, "walletAddress") || null,
      funding: (body.funding ?? []) as { txid: string; vout: number }[],
      minerFeeSats: bigintField(body, "minerFeeSats", 1000n),
      idempotencyKey: strField(body, "idempotencyKey") || `buy-${Date.now()}`,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
