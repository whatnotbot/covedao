import { eq } from "drizzle-orm";
import { fail, ok } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { schema } from "@crclaunch/db";
import { getConfig } from "@/lib/env";
import { isAdmin } from "@/lib/admin";

export async function GET(req: Request) {
  // READ may keep the dev convenience bypass; writes (PUT) may not.
  if (!isAdmin(req, { allowDevBypass: true })) return fail("UNAUTHORIZED", "Admin access required.", 401);
  const { db, adapter, bitcoin, node } = getServices();
  await initServices();
  const health = await adapter.getHealth();
  const btcHeight = await bitcoin.getHeight();
  const protocolHeight = node ? await node.getHeight() : await adapter.getCurrentHeight();

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
  // Writes require a real bearer token — the dev bypass must not authorize them.
  if (!isAdmin(req, { allowDevBypass: false })) return fail("UNAUTHORIZED", "Admin access required.", 401);
  const { db } = getServices();
  const body = (await req.json()) as { id?: string; enabled?: boolean };
  if (!body.id) return fail("INVALID_INPUT", "Flag id required.", 400);

  const before = await db.select().from(schema.featureFlags).where(eq(schema.featureFlags.id, body.id)).execute();
  const previous = before[0]?.enabled ?? null;

  await db
    .update(schema.featureFlags)
    .set({ enabled: !!body.enabled, updatedAt: new Date() })
    .where(eq(schema.featureFlags.id, body.id));

  // Record every flag mutation (who, what, from, to, when).
  await db.insert(schema.adminAuditLogs).values({
    adminId: "bearer",
    action: "feature_flag_update",
    targetType: "feature_flag",
    targetId: body.id,
    details: { from: previous, to: !!body.enabled },
  });

  return ok({ id: body.id, enabled: !!body.enabled });
}
