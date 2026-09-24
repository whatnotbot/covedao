import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { AppError } from "@crclaunch/cove-app";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  try {
    const { app } = getV3Services();
    const { tokenId } = await params;
    const detail = await app.tokenDetail(tokenId);
    if (!detail) throw new AppError("TOKEN_NOT_FOUND", "token not found");
    return ok(detail);
  } catch (e) {
    return handleError(e);
  }
}
