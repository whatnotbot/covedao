import { ok, handleError } from "@/lib/api";
import { getV3Services } from "@/lib/v3-server";
import { addressToScript } from "@/lib/address";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const limited = checkRateLimit(req, "read-portfolio");
    if (limited) return limited;
    const { app, config } = getV3Services();
    const { address } = await params;
    const script = addressToScript(address, config.network);
    return ok(await app.walletPortfolio(script));
  } catch (e) {
    return handleError(e);
  }
}
