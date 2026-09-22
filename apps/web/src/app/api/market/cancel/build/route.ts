import { fail, handleError, ok, readJson } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { cancelBuildSchema } from "@crclaunch/schemas";

export async function POST(req: Request) {
  const { adapter } = getServices();
  await initServices();
  const body = await readJson(req);
  const parsed = cancelBuildSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.", 400);
  try {
    const listing = await adapter.getListing(parsed.data.listingId);
    if (!listing) return fail("LISTING_ALREADY_TAKEN", "Listing not found.", 404);
    const unsigned = await adapter.buildCancelListing({
      deploymentId: listing.deploymentId,
      listingId: parsed.data.listingId,
      sellerAddress: parsed.data.sellerAddress,
    });
    return ok({ unsignedTx: unsigned });
  } catch (e) {
    return handleError(e);
  }
}
