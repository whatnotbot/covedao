import { readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { broadcastSchema } from "@crclaunch/schemas";
import { broadcastOperation } from "@/lib/broadcast-service";
import { fail } from "@/lib/api";

export async function POST(req: Request) {
  const { db, adapter, config } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = broadcastSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  return broadcastOperation(db, adapter, config, {
    signedPsbt: parsed.data.signedPsbt,
    walletAddress: parsed.data.walletAddress,
    operation: "DEPLOY",
  });
}
