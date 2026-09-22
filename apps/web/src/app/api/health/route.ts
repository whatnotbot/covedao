import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";

export async function GET() {
  const { config } = getServices();
  return ok({
    name: config.appName,
    network: config.network,
    protocolVerified: config.protocolVerified,
  });
}
