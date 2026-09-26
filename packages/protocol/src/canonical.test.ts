import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./mock/store.js";
import { MockChainNode } from "./mock/node.js";
import { MockCRCAdapter } from "./mock/adapter.js";
import { MockCanonicalCRCProvider, crcLaunchV1DeploymentRules } from "./canonical-mock.js";

describe("CanonicalCRCProvider (mock)", () => {
  it("advertises full capabilities in demo mode", async () => {
    const node = new MockChainNode(new MemoryStorage(), "mock");
    await node.init();
    const provider = new MockCanonicalCRCProvider(new MockCRCAdapter(node), node);
    const caps = await provider.getCapabilities();
    expect(caps.progressiveMint).toBe(true);
    expect(caps.marketplace).toBe(true);
    expect(caps.customSupply).toBe(false);
  });

  it("exposes the crc-launch-v1 deployment rules", () => {
    const rules = crcLaunchV1DeploymentRules();
    expect(rules.profile).toBe("crc-launch-v1");
    expect(rules.decimals).toBe(8);
    expect(rules.maxSupplyAtoms).toBe(2_100_000_000_000_000n); // 21M tokens @ 8dp
    expect(rules.stageCount).toBe(210);
    expect(rules.creatorPremineAtoms).toBe(0n);
    expect(rules.priceTableSatsPerMillion.length).toBe(210);
  });

  it("authorizes a mint with the correct required payment", async () => {
    const node = new MockChainNode(new MemoryStorage(), "mock");
    await node.init();
    const adapter = new MockCRCAdapter(node);
    const provider = new MockCanonicalCRCProvider(adapter, node);

    const deploy = await adapter.buildDeploy({
      ticker: "FROG",
      name: "Frog",
      creatorAddress: "bc1qm0ckcreator00000000000000000000000000000000000000",
      treasuryAddress: "bc1qm0cktreasury000000000000000000000000000000000000",
      launchFeeSats: 10_000n,
      network: "mock",
    });
    await adapter.broadcast(`${deploy.psbtBase64}\nMOCK-SIGNED-BY:bc1qm0ckcreator00000000000000000000000000000000000000`);
    await node.mineBlock();
    const token = (await adapter.getTokenByTicker("FROG"))!;

    const auth = await provider.requestMintAuthorization({
      deploymentId: token.deploymentId,
      walletAddress: "bc1qm0ckbuyer0000000000000000000000000000000000000000",
      requestedAmountAtoms: 1_000n * 100_000_000n, // one lot @ 8dp
    });
    expect(auth.authorized).toBe(true);
    expect(auth.requiredPaymentSats).toBe(33n); // stair 1: 33 sats a lot
  });
});
