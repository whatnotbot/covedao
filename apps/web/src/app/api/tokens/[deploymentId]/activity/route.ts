import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { listEventsForToken } from "@crclaunch/db";

export async function GET(req: Request, ctx: { params: Promise<{ deploymentId: string }> }) {
  const { db } = getServices();
  const { deploymentId } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const events = await listEventsForToken(db, deploymentId, limit, offset);
  return ok(
    events.map((e) => ({
      txid: e.txid,
      blockHeight: e.blockHeight.toString(),
      eventType: e.eventType,
      walletFrom: e.walletFrom,
      walletTo: e.walletTo,
      tokenAmountAtoms: e.tokenAmountAtoms?.toString() ?? null,
      btcAmountSats: e.btcAmountSats?.toString() ?? null,
      payload: e.payloadJson,
      canonical: e.canonical,
    })),
  );
}
