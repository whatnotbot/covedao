import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const funding = (body.funding ?? []) as { txid: string; vout: number }[];
    const result = await app.buildLaunch({
      network: strField(body, "network"),
      ticker: strField(body, "ticker"),
      nonceHex: strField(body, "nonceHex"),
      walletScript: strField(body, "walletScript"),
      walletAddress: strField(body, "walletAddress") || null,
      funding,
      minerFeeSats: bigintField(body, "minerFeeSats", 1000n),
      metadata: {
        displayName: strField(body, "displayName"),
        description: strField(body, "description"),
        websiteUrl: strField(body, "websiteUrl") || null,
        xUrl: strField(body, "xUrl") || null,
        imageUrl: strField(body, "imageUrl") || null,
      },
      idempotencyKey: strField(body, "idempotencyKey") || `launch-${Date.now()}`,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
