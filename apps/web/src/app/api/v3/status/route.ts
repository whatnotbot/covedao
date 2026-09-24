import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { app } = getV3Services();
    return ok(await app.status());
  } catch (e) {
    return handleError(e);
  }
}
