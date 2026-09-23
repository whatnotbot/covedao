import { fail, ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { getTokenByDeployment, getTokenMetadataForDeployment } from "@crclaunch/db";
import { tokenView } from "@/lib/token-view";

export async function GET(_req: Request, ctx: { params: Promise<{ deploymentId: string }> }) {
  const { db, config } = getServices();
  const { deploymentId } = await ctx.params;
  const token = await getTokenByDeployment(db, config.network, deploymentId);
  if (!token) return fail("NOT_FOUND", "Token not found.", 404);
  const meta = await getTokenMetadataForDeployment(db, token.deploymentTxid);
  return ok(tokenView(token, meta));
}
