import { ok } from "@/lib/api";
import { initServices, getServices } from "@/lib/server";

export async function GET() {
  const { adapter, node } = getServices();
  await initServices();
  const height = node ? await node.getHeight() : await adapter.getCurrentHeight();
  return ok({ height: height.toString() });
}
