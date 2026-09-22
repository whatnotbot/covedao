import { fail, ok, readJson } from "@/lib/api";
import { getServices } from "@/lib/server";
import { reportSchema } from "@crclaunch/schemas";
import { schema } from "@crclaunch/db";

export async function POST(req: Request) {
  const { db } = getServices();
  const body = await readJson(req);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  await db.insert(schema.reports).values({
    targetType: "token",
    deploymentId: parsed.data.deploymentId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
  });
  return ok({ reported: true });
}
