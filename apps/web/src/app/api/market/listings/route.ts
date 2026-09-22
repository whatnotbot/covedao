import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { listOpenListings } from "@crclaunch/db";

export async function GET(req: Request) {
  const { db } = getServices();
  const url = new URL(req.url);
  const deploymentId = url.searchParams.get("deploymentId") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const rows = deploymentId ? await listOpenListings(db, deploymentId, limit, offset) : [];
  return ok(
    rows.map((l) => ({
      listingId: l.listingId,
      deploymentId: l.deploymentId,
      sellerAddress: l.sellerAddress,
      tokenAmountAtoms: l.tokenAmountAtoms.toString(),
      askingPriceSats: l.askingPriceSats.toString(),
      pricePerMillionSats: (l.askingPriceSats * 1_000_000n) / l.tokenAmountAtoms,
      creationHeight: l.creationHeight.toString(),
      expiryHeight: l.expiryHeight.toString(),
      status: l.status,
    })),
  );
}
