import { describe, expect, it } from "vitest";
import { computePlatformFee, PUBLIC_SUPPLY_ATOMS } from "@crclaunch/curve";
import { MemoryStorage } from "./store.js";
import { MockChainNode } from "./node.js";
import { MockCRCAdapter } from "./adapter.js";
import { MOCK_FAUCET_SATS } from "./chain.js";

const TREASURY = "bc1qm0cktreasury000000000000000000000000000000000000";

async function setup() {
  const node = new MockChainNode(new MemoryStorage(), "mock");
  await node.init();
  const adapter = new MockCRCAdapter(node);
  return { node, adapter };
}

async function signAndSubmit(
  adapter: MockCRCAdapter,
  unsigned: { psbtBase64: string | null },
  signer: string,
): Promise<string> {
  const psbt = unsigned.psbtBase64 ?? "";
  const signed = `${psbt}\nMOCK-SIGNED-BY:${signer}`;
  return adapter.broadcast(signed);
}

describe("mock chain end-to-end", () => {
  it("deploys a token, mints, graduates, lists and trades it", async () => {
    const { node, adapter } = await setup();

    const creator = "bc1qm0ckcreator00000000000000000000000000000000000000";
    const buyer = "bc1qm0ckbuyer0000000000000000000000000000000000000000";
    const buyer2 = "bc1qm0ckbuyer200000000000000000000000000000000000000";

    // DEPLOY
    const deploy = await adapter.buildDeploy({
      ticker: "FROG",
      name: "Frog Token",
      creatorAddress: creator,
      treasuryAddress: TREASURY,
      launchFeeSats: 10_000n,
      network: "mock",
    });
    await signAndSubmit(adapter, deploy, creator);
    await node.mineBlock();

    const token = await adapter.getTokenByTicker("FROG");
    expect(token).not.toBeNull();
    expect(token!.confirmedMintedAtoms).toBe(0n);

    // MINT full supply (single tx for brevity)
    const curve = 24_196_788n;
    const platformFee = computePlatformFee(curve, 100n);
    const minerFee = 450n;
    const mint = await adapter.buildMint({
      deploymentId: token!.deploymentId,
      ticker: "FROG",
      buyerAddress: buyer,
      treasuryAddress: TREASURY,
      tokenAmountAtoms: PUBLIC_SUPPLY_ATOMS,
      curveContributionSats: curve,
      platformFeeSats: platformFee,
      minerFeeSats: minerFee,
      currentSupplyAtoms: 0n,
      stateHash: await node.getStateHash(),
    });
    await signAndSubmit(adapter, mint, buyer);
    await node.mineBlock();

    const soldOut = await adapter.getTokenByDeployment(token!.deploymentId);
    expect(soldOut!.confirmedMintedAtoms).toBe(PUBLIC_SUPPLY_ATOMS);
    expect(soldOut!.status).toBe("SOLD_OUT");
    const buyerBal = await node.getWalletBalance(buyer);
    expect(buyerBal.tokens[token!.deploymentId]).toBe(PUBLIC_SUPPLY_ATOMS);

    // GRADUATE
    await adapter.graduate(token!.deploymentId);
    await node.mineBlock();
    const graduated = await adapter.getTokenByDeployment(token!.deploymentId);
    expect(graduated!.status).toBe("GRADUATED");

    // LIST
    const askAmount = 1_000_000n;
    const askPrice = 149_731n;
    const list = await adapter.buildSellListing({
      deploymentId: token!.deploymentId,
      sellerAddress: buyer,
      tokenAmountAtoms: askAmount,
      askingPriceSats: askPrice,
      expiryHeight: (await node.getHeight()) + 144n,
    });
    await signAndSubmit(adapter, list, buyer);
    await node.mineBlock();

    const listings = await adapter.getListings();
    const listing = listings.find((l) => l.tokenAmountAtoms === askAmount);
    expect(listing).toBeDefined();
    expect(listing!.status).toBe("OPEN");

    // BUY
    const buy = await adapter.buildBuySettlement({
      deploymentId: token!.deploymentId,
      listingId: listing!.id,
      buyerAddress: buyer2,
      tokenAmountAtoms: askAmount,
      totalPriceSats: askPrice,
      sellerAddress: buyer,
      protocolFeeSats: 0n,
      platformFeeSats: 0n,
      minerFeeSats: 450n,
      treasuryAddress: TREASURY,
    });
    await signAndSubmit(adapter, buy, buyer2);
    await node.mineBlock();

    const taken = await adapter.getListing(listing!.id);
    expect(taken!.status).toBe("TAKEN");
    const buyer2Bal = await node.getWalletBalance(buyer2);
    expect(buyer2Bal.tokens[token!.deploymentId]).toBe(askAmount);
    const sellerBal = await node.getWalletBalance(buyer);
    expect(sellerBal.tokens[token!.deploymentId]).toBe(PUBLIC_SUPPLY_ATOMS - askAmount);

    const events = await adapter.getEvents(1n, 100n);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("DEPLOY");
    expect(types).toContain("MINT");
    expect(types).toContain("GRADUATION");
    expect(types).toContain("DEX_ASK");
    expect(types).toContain("DEX_BID");
  });

  it("oversubscription race: second mint with stale supply is rejected", async () => {
    const { node, adapter } = await setup();
    const creator = "bc1qm0ckcreator00000000000000000000000000000000000000";
    const b1 = "bc1qm0ckbuyer100000000000000000000000000000000000000";
    const b2 = "bc1qm0ckbuyer200000000000000000000000000000000000000";

    const deploy = await adapter.buildDeploy({
      ticker: "RACE", name: "Race", creatorAddress: creator, treasuryAddress: TREASURY, launchFeeSats: 10_000n, network: "mock",
    });
    await signAndSubmit(adapter, deploy, creator);
    await node.mineBlock();
    const token = (await adapter.getTokenByTicker("RACE"))!;
    const stateHash = await node.getStateHash();

    // Both mint the final tokens from the same stale supply snapshot.
    const mint1 = await adapter.buildMint({
      deploymentId: token.deploymentId, ticker: "RACE", buyerAddress: b1, treasuryAddress: TREASURY,
      tokenAmountAtoms: PUBLIC_SUPPLY_ATOMS, curveContributionSats: 24_196_788n,
      platformFeeSats: computePlatformFee(24_196_788n, 100n), minerFeeSats: 450n,
      currentSupplyAtoms: 0n, stateHash,
    });
    const mint2 = await adapter.buildMint({
      deploymentId: token.deploymentId, ticker: "RACE", buyerAddress: b2, treasuryAddress: TREASURY,
      tokenAmountAtoms: PUBLIC_SUPPLY_ATOMS, curveContributionSats: 24_196_788n,
      platformFeeSats: computePlatformFee(24_196_788n, 100n), minerFeeSats: 450n,
      currentSupplyAtoms: 0n, stateHash,
    });

    await signAndSubmit(adapter, mint1, b1);
    await signAndSubmit(adapter, mint2, b2);
    await node.mineBlock();

    const tx1 = await adapter.getTransaction(mint1.psbtBase64 ? txidOf(mint1.psbtBase64) : "");
    const tx2 = await adapter.getTransaction(mint2.psbtBase64 ? txidOf(mint2.psbtBase64) : "");
    expect([tx1.status, tx2.status].sort()).toEqual(["CONFIRMED", "REJECTED"]);
    const after = await adapter.getTokenByDeployment(token.deploymentId);
    expect(after!.confirmedMintedAtoms).toBe(PUBLIC_SUPPLY_ATOMS);
  });

  it("3-block reorg reconciles derived state", async () => {
    const { node, adapter } = await setup();
    const creator = "bc1qm0ckcreator00000000000000000000000000000000000000";
    const buyer = "bc1qm0ckbuyer0000000000000000000000000000000000000000";

    const deploy = await adapter.buildDeploy({
      ticker: "RORG", name: "Reorg", creatorAddress: creator, treasuryAddress: TREASURY, launchFeeSats: 10_000n, network: "mock",
    });
    await signAndSubmit(adapter, deploy, creator);
    await node.mineBlock();
    const token = (await adapter.getTokenByTicker("RORG"))!;

    // Three sequential mints, each in its own block.
    for (let i = 0; i < 3; i++) {
      const mint = await adapter.buildMint({
        deploymentId: token.deploymentId, ticker: "RORG", buyerAddress: buyer, treasuryAddress: TREASURY,
        tokenAmountAtoms: 2_000_000n, curveContributionSats: 1_000n, platformFeeSats: 10n,
        minerFeeSats: 450n, currentSupplyAtoms: BigInt(i * 2_000_000), stateHash: await node.getStateHash(),
      });
      await signAndSubmit(adapter, mint, buyer);
      await node.mineBlock();
    }

    const before = await adapter.getTokenByDeployment(token.deploymentId);
    expect(before!.confirmedMintedAtoms).toBe(6_000_000n);

    await node.reorg(3);
    const afterReorg = await adapter.getTokenByDeployment(token.deploymentId);
    expect(afterReorg!.confirmedMintedAtoms).toBe(0n); // mints were reverted

    // Re-mine the returned mempool txs.
    for (let i = 0; i < 3; i++) await node.mineBlock();
    const afterRemine = await adapter.getTokenByDeployment(token.deploymentId);
    expect(afterRemine!.confirmedMintedAtoms).toBe(6_000_000n);
  });

  it("mint is rejected when buyer lacks BTC", async () => {
    const { node, adapter } = await setup();
    const creator = "bc1qm0ckcreator00000000000000000000000000000000000000";
    const poor = "bc1qm0ckpoor00000000000000000000000000000000000000000";
    const deploy = await adapter.buildDeploy({
      ticker: "POOR", name: "Poor", creatorAddress: creator, treasuryAddress: TREASURY, launchFeeSats: 10_000n, network: "mock",
    });
    await signAndSubmit(adapter, deploy, creator);
    await node.mineBlock();
    const token = (await adapter.getTokenByTicker("POOR"))!;

    // Drain the poor wallet's faucet (create a zero balance entry, persisted).
    await node.mutate((s) => {
      s.balances[poor] = { btcSats: 0n, tokens: {}, lockedTokens: {} };
    });

    const mint = await adapter.buildMint({
      deploymentId: token.deploymentId, ticker: "POOR", buyerAddress: poor, treasuryAddress: TREASURY,
      tokenAmountAtoms: 2_000_000n, curveContributionSats: 1_000n, platformFeeSats: 10n,
      minerFeeSats: 450n, currentSupplyAtoms: 0n, stateHash: await node.getStateHash(),
    });
    await signAndSubmit(adapter, mint, poor);
    await node.mineBlock();
    const tx = await adapter.getTransaction(txidOf(mint.psbtBase64!));
    expect(tx.status).toBe("REJECTED");
  });

  it("faucet grants 10 BTC in mock mode", async () => {
    const { node } = await setup();
    const bal = await node.getWalletBalance("bc1qm0ckanyone0000000000000000000000000000000000000");
    expect(bal.btcSats).toBe(MOCK_FAUCET_SATS);
  });
});

function txidOf(psbtBase64: string): string {
  const json = Buffer.from(psbtBase64, "base64").toString("utf8");
  return JSON.parse(json).txid as string;
}

