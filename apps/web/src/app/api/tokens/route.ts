import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { listTokens, listMetadataByTokenIds } from "@crclaunch/db";
import { tokenView } from "@/lib/token-view";

export async function GET(req: Request) {
  const { db, config } = getServices();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);

  const rows = await listTokens(db, { network: config.network, status, limit });
  const metas = await listMetadataByTokenIds(db, rows.map((r) => r.id));
  const metaMap = new Map(metas.map((m) => [m.tokenId, m]));
  return ok(rows.map((r) => tokenView(r, metaMap.get(r.id))));
}
