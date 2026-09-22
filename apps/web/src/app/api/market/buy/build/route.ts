import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { buyBuildSchema } from "@crclaunch/schemas";
import { treasuryAddress } from "@/lib/treasury";

export async function POST(req: Request) {
  const { adapter, config } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = buyBuildSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  try {
    const listing = await adapter.getListing(parsed.data.listingId);
    if (!listing || listing.status !== "OPEN") {
      return fail("LISTING_ALREADY_TAKEN", "Listing is no longer available.", 409);
    }
    // V1 mock: no platform or protocol marketplace fee (section 19).
    const minerFee = 450n;
    const unsigned = await adapter.buildBuySettlement({
      deploymentId: listing.deploymentId,
      listingId: listing.id,
      buyerAddress: parsed.data.buyerAddress,
      tokenAmountAtoms: listing.tokenAmountAtoms,
      totalPriceSats: listing.askingPriceSats,
      sellerAddress: listing.sellerAddress,
      protocolFeeSats: 0n,
      platformFeeSats: 0n,
      minerFeeSats: minerFee,
      treasuryAddress: treasuryAddress(config),
    });
    return ok({ unsignedTx: unsigned });
  } catch (e) {
    return handleError(e);
  }
}
