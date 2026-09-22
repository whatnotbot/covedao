import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { sellBuildSchema } from "@crclaunch/schemas";

export async function POST(req: Request) {
  const { adapter } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = sellBuildSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  try {
    const height = await adapter.getCurrentHeight();
    const unsigned = await adapter.buildSellListing({
      deploymentId: parsed.data.deploymentId,
      sellerAddress: parsed.data.sellerAddress,
      tokenAmountAtoms: BigInt(parsed.data.tokenAmountAtoms),
      askingPriceSats: BigInt(parsed.data.askingPriceSats),
      expiryHeight: height + BigInt(parsed.data.expiryBlocks),
    });
    const listingId = unsigned.psbtBase64 ? extractTxid(unsigned.psbtBase64) : "";
    return ok({ unsignedTx: unsigned, listingId });
  } catch (e) {
    return handleError(e);
  }
}

function extractTxid(psbtBase64: string): string {
  const json = Buffer.from(psbtBase64, "base64").toString("utf8");
  return (JSON.parse(json) as { txid?: string }).txid ?? "";
}
