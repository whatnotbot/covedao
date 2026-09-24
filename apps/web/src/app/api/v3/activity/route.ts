import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { desc, eq } from "drizzle-orm";
import { schema } from "@crclaunch/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { db, config } = getV3Services();
    const events = await db
      .select()
      .from(schema.coveV3Events)
      .where(eq(schema.coveV3Events.network, config.network))
      .orderBy(desc(schema.coveV3Events.blockHeight))
      .limit(100);
    return ok(events);
  } catch (e) {
    return handleError(e);
  }
}
