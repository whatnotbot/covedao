import { ok, handleError, readJson, strField, bigintField } from "@/lib/api";
import { assertV3Enabled } from "@/lib/v3-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const limited = checkRateLimit(req, "build-redeem");
    if (limited) return limited;
    const { app } = assertV3Enabled();
    const body = await readJson(req);
    const result = await app.buildRedeem({
      tokenId: strField(body, "tokenId"),
      amountAtoms: bigintField(body, "amountAtoms", 0n),
      walletScript: strField(body, "walletScript"),
      walletAddress: strField(body, "walletAddress") || null,
      minerFeeSats: bigintField(body, "minerFeeSats", 1000n),
      // Optional: BTC utxos to pay the miner fee. Without them the fee can only
      // come from token carriers, which caps it at ~1,000 sats each.
      funding: Array.isArray(body.funding) ? (body.funding as { txid: string; vout: number }[]) : undefined,
      idempotencyKey: strField(body, "idempotencyKey") || `redeem-${Date.now()}`,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}
