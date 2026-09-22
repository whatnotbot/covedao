import { ok } from "@/lib/api";
import { getServices, initServices } from "@/lib/server";
import { writeModeLabel, productMode } from "@crclaunch/config";

export async function GET() {
  const { config, adapter, bitcoin, node } = getServices();
  await initServices();
  const health = await adapter.getHealth();
  const btcHeight = await bitcoin.getHeight();
  const protocolHeight = node ? await node.getHeight() : await adapter.getCurrentHeight();
  return ok({
    bitcoin: { height: btcHeight.toString(), synced: true },
    protocol: {
      height: protocolHeight.toString(),
      state: health.state,
      synced: health.synced,
      stateValid: health.stateValid,
      lagBlocks: health.lagBlocks.toString(),
    },
    writeMode: writeModeLabel(config, health),
    mode: productMode(config),
    network: config.network,
    protocolVerified: config.protocolVerified,
  });
}
