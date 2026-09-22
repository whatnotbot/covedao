import { fail, ok } from "@/lib/api";
import { getServices } from "@/lib/server";

export async function GET(_req: Request, ctx: { params: Promise<{ txid: string }> }) {
  const { adapter } = getServices();
  const { txid } = await ctx.params;
  try {
    const status = await adapter.getTransaction(txid);
    return ok(status);
  } catch {
    return fail("NOT_FOUND", "Transaction not found.", 404);
  }
}
