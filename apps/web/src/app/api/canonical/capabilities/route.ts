import { ok } from "@/lib/api";
import { getServices } from "@/lib/server";
import { productMode } from "@crclaunch/config";

export async function GET() {
  const { canonical, config } = getServices();
  const capabilities = await canonical.getCapabilities();
  return ok({
    mode: productMode(config),
    capabilities,
  });
}
