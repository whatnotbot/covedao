import { eq } from "drizzle-orm";
import { fail, ok } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { schema } from "@crclaunch/db";
import { getConfig } from "@/lib/env";

async function isAdmin(req: Request): Promise<boolean> {
  const config = getConfig();
  if (config.nodeEnv !== "production" && !config.adminAuthSecret) return true; // dev convenience
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return config.adminAuthSecret !== null && token === config.adminAuthSecret;
}

export async function GET(req: Request) {
  if (!(await isAdmin(req))) return fail("UNAUTHORIZED", "Admin access required.", 401);
  const { db, adapter, bitcoin, node } = getServices();
  await initServices();
  const health = await adapter.getHealth();
  const btcHeight = await bitcoin.getHeight();
  const protocolHeight = node ? await node.getHeight() : await adapter.getCurrentHeight();

  const [tokenCount] = await db.select({ c: schema.tokens.id }).from(schema.tokens).execute();
  void tokenCount;
  const counts = {
    tokens: (await db.select().from(schema.tokens)).length,
    events: (await db.select().from(schema.chainEvents)).length,
    listings: (await db.select().from(schema.listings)).length,
    trades: (await db.select().from(schema.trades)).length,
  };

  return ok({
    network: getConfig().network,
    protocolVerified: getConfig().protocolVerified,
    protocol: { state: health.state, synced: health.synced, stateValid: health.stateValid, lagBlocks: health.lagBlocks.toString() },
    bitcoinHeight: btcHeight.toString(),
    protocolHeight: protocolHeight.toString(),
    counts,
  });
}

export async function PUT(req: Request) {
  if (!(await isAdmin(req))) return fail("UNAUTHORIZED", "Admin access required.", 401);
  const { db } = getServices();
  const body = (await req.json()) as { id?: string; enabled?: boolean };
  if (!body.id) return fail("INVALID_INPUT", "Flag id required.", 400);
  await db
    .update(schema.featureFlags)
    .set({ enabled: !!body.enabled, updatedAt: new Date() })
    .where(eq(schema.featureFlags.id, body.id));
  return ok({ id: body.id, enabled: !!body.enabled });
}
