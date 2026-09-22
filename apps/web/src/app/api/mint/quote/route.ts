import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { mintQuoteSchema } from "@crclaunch/schemas";
import { computeQuote } from "@/lib/mint-service";

export async function POST(req: Request) {
  const { db, adapter, bitcoin, config } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = mintQuoteSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  try {
    const quote = await computeQuote(db, adapter, bitcoin, config, {
      deploymentId: parsed.data.deploymentId,
      mode: parsed.data.mode,
      tokens: parsed.data.tokens,
      sats: parsed.data.sats,
      walletAddress: parsed.data.walletAddress,
    });
    return ok(quote);
  } catch (e) {
    return handleError(e);
  }
}
