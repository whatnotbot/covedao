import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { listHolders } from "@crclaunch/db";

export async function GET(req: Request, ctx: { params: Promise<{ deploymentId: string }> }) {
  const { db, config } = getServices();
  const { deploymentId } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const holders = await listHolders(db, config.network, deploymentId, limit, offset);
  return ok(
    holders.map((h) => ({
      walletAddress: h.walletAddress,
      balanceAtoms: h.balanceAtoms.toString(),
      pendingAtoms: h.pendingAtoms.toString(),
      lockedAtoms: h.lockedAtoms.toString(),
    })),
  );
}
