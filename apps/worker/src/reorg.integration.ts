import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { loadConfig } from "@crclaunch/config";
import { createDb, resetAllTables, schema, type Database } from "@crclaunch/db";
import {
  MockChainNode,
  MemoryStorage,
  MockCRCAdapter,
  MOCK_TREASURY_ADDRESS,
} from "@crclaunch/protocol";
import { quoteExactTokens, computePlatformFee, PUBLIC_SUPPLY_ATOMS } from "@crclaunch/curve";
import { detectReorg, rebuildProjections, syncMockToDb } from "./sync.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("  ok:", msg);
}

async function canonicalProjection(db: Database, network: string): Promise<string> {
  const tokens = (await db.select().from(schema.tokens).execute())
    .filter((t) => t.network === network)
    .map(
      (t) =>
        `${t.deploymentTxid}:${t.ticker}:${t.status}:${t.confirmedMintedAtoms}:${t.currentStage}:${t.reserveSats}:${t.lastTradePricePerMillion ?? "null"}`,
    )
    .sort();
  const balances = (await db.select().from(schema.walletTokenBalances).execute())
    .filter((b) => b.network === network)
    .map((b) => `${b.walletAddress}:${b.deploymentId}:${b.balanceAtoms}:${b.lockedAtoms}`)
    .sort();
  const listings = (await db.select().from(schema.listings).execute())
    .filter((l) => l.network === network)
    .map((l) => `${l.listingId}:${l.status}:${l.tokenAmountAtoms}:${l.askingPriceSats}`)
    .sort();
  const trades = (await db.select().from(schema.trades).execute())
    .filter((t) => t.network === network)
    .map(
      (t) =>
        `${t.txid}:${t.listingId}:${t.buyerAddress}:${t.sellerAddress}:${t.tokenAmountAtoms}:${t.priceSats}:${t.canonical}`,
    )
    .sort();
  const mints = (await db.select().from(schema.mints).execute())
    .filter((m) => m.network === network)
    .map((m) => `${m.txid}:${m.canonical}:${m.tokenAmountAtoms}`)
    .sort();
  const events = (await db.select().from(schema.chainEvents).execute())
    .filter((e) => e.network === network)
    .map((e) => `${e.txid}:${e.canonical}:${e.eventType}:${e.blockHeight}`)
    .sort();
  const blocks = (await db.select().from(schema.blocks).execute())
    .filter((b) => b.network === network)
    .map((b) => `${b.height}:${b.hash}:${b.canonical}`)
    .sort();
  return JSON.stringify({ tokens, balances, listings, trades, mints, events, blocks });
}

const CREATOR = "bc1qm0ckcreator00000000000000000000000000000000000000";
const BUYER = "bc1qm0ckbuyer0000000000000000000000000000000000000000";

async function deployToken(
  node: MockChainNode,
  adapter: MockCRCAdapter,
  ticker: string,
  creatorAddress: string,
): Promise<string> {
  const d = await adapter.buildDeploy({
    ticker,
    name: ticker,
    creatorAddress,
    treasuryAddress: MOCK_TREASURY_ADDRESS,
    launchFeeSats: 10_000n,
    network: node.snapshot.network,
  });
  // The deploy txid IS the deploymentId (mock chain applies it as such).
  return adapter.broadcast(`${d.psbtBase64}\nMOCK-SIGNED-BY:${creatorAddress}`);
}

async function mintToken(
  node: MockChainNode,
  adapter: MockCRCAdapter,
  deploymentId: string,
  buyerAddress: string,
  amount: bigint,
): Promise<void> {
  const token = (await node.getAllTokens()).find((t) => t.deploymentId === deploymentId)!;
  const q = quoteExactTokens({ desiredTokens: amount, currentSupply: token.confirmedMintedAtoms });
  const m = await adapter.buildMint({
    deploymentId,
    ticker: token.ticker,
    buyerAddress,
    treasuryAddress: MOCK_TREASURY_ADDRESS,
    tokenAmountAtoms: amount,
    curveContributionSats: q.curveContributionSats,
    platformFeeSats: computePlatformFee(q.curveContributionSats, 100n),
    minerFeeSats: 450n,
    currentSupplyAtoms: token.confirmedMintedAtoms,
    stateHash: await node.getStateHash(),
  });
  await adapter.broadcast(`${m.psbtBase64}\nMOCK-SIGNED-BY:${buyerAddress}`);
}

async function graduateToken(
  node: MockChainNode,
  adapter: MockCRCAdapter,
  deploymentId: string,
): Promise<void> {
  await adapter.graduate(deploymentId);
  await node.mineBlock();
}

async function listToken(
  node: MockChainNode,
  adapter: MockCRCAdapter,
  deploymentId: string,
  sellerAddress: string,
  tokenAmountAtoms: bigint,
  askingPriceSats: bigint,
): Promise<string> {
  const height = await node.getHeight();
  const l = await adapter.buildSellListing({
    deploymentId,
    sellerAddress,
    tokenAmountAtoms,
    askingPriceSats,
    expiryHeight: height + 100n,
  });
  return adapter.broadcast(`${l.psbtBase64}\nMOCK-SIGNED-BY:${sellerAddress}`);
}

async function buyToken(
  node: MockChainNode,
  adapter: MockCRCAdapter,
  deploymentId: string,
  listingId: string,
  buyerAddress: string,
  sellerAddress: string,
  tokenAmountAtoms: bigint,
  totalPriceSats: bigint,
): Promise<void> {
  const b = await adapter.buildBuySettlement({
    deploymentId,
    listingId,
    buyerAddress,
    tokenAmountAtoms,
    totalPriceSats,
    sellerAddress,
    protocolFeeSats: 0n,
    platformFeeSats: 0n,
    minerFeeSats: 450n,
    treasuryAddress: MOCK_TREASURY_ADDRESS,
  });
  await adapter.broadcast(`${b.psbtBase64}\nMOCK-SIGNED-BY:${buyerAddress}`);
}

async function main() {
  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl);
  const network = config.network;
  console.log("=== DB reorg integration test (deploy/mint/list/trade) ===");

  // ONE canonical node — both DB A (incremental+reorg) and DB B (clean reindex)
  // are projections of the SAME node state, so txids/blocks are identical.
  const node = new MockChainNode(new MemoryStorage(), network);
  await node.init();
  const adapter = new MockCRCAdapter(node);

  await resetAllTables(db);

  // Deploy FROG.
  const frogId = await deployToken(node, adapter, "FROG", CREATOR);
  await node.mineBlock();
  await syncMockToDb(db, node, network);

  // Mint the full public supply (SOLD_OUT), then graduate.
  await mintToken(node, adapter, frogId, BUYER, PUBLIC_SUPPLY_ATOMS);
  await node.mineBlock();
  await syncMockToDb(db, node, network);
  await graduateToken(node, adapter, frogId);
  await syncMockToDb(db, node, network);

  const frog = (await node.getAllTokens()).find((t) => t.deploymentId === frogId)!;
  assert(frog.status === "GRADUATED", "FROG graduated after full mint");

  // List 1M FROG (seller = BUYER, who holds the tokens).
  const listingId = await listToken(node, adapter, frogId, BUYER, 1_000_000n, 1_000_000n);
  await node.mineBlock();
  await syncMockToDb(db, node, network);
  assert(listingId.length > 0, "listing created (OPEN)");

  // Trade 1M FROG (buyer = CREATOR).
  await buyToken(node, adapter, frogId, listingId, CREATOR, BUYER, 1_000_000n, 1_000_000n);
  await node.mineBlock();
  await syncMockToDb(db, node, network);
  const tradesAfterBuy = (await db.select().from(schema.trades).execute()).filter(
    (t) => t.network === network,
  );
  assert(tradesAfterBuy.length === 1, "trade projected into DB");

  // Deploy TOAD (a second deployment to orphan).
  await deployToken(node, adapter, "TOAD", CREATOR);
  await node.mineBlock();
  await syncMockToDb(db, node, network);

  // Reorg away the last 3 blocks: TOAD deploy, the trade, and the listing.
  await node.reorg(3);
  const reorged = await detectReorg(db, node, network);
  assert(reorged, "reorg detected via stored block history");
  await rebuildProjections(db, node, network);

  const toad = (await db.select().from(schema.tokens).execute()).filter((t) => t.ticker === "TOAD");
  assert(toad.length === 0, "orphaned TOAD deploy removed");
  const tradesAfterReorg = (await db.select().from(schema.trades).execute()).filter(
    (t) => t.network === network,
  );
  assert(tradesAfterReorg.length === 0, "orphaned trade removed");
  const listingsAfterReorg = (await db.select().from(schema.listings).execute()).filter(
    (l) => l.network === network,
  );
  assert(listingsAfterReorg.length === 0, "orphaned listing removed");
  const frogAfterReorg = (await db.select().from(schema.tokens).execute()).filter(
    (t) => t.ticker === "FROG",
  )[0];
  assert(
    frogAfterReorg!.confirmedMintedAtoms === PUBLIC_SUPPLY_ATOMS,
    "FROG supply intact after reorg",
  );

  const projectionA = await canonicalProjection(db, network);

  // Clean reindex: truncate everything and re-sync the SAME canonical node state.
  await resetAllTables(db);
  await syncMockToDb(db, node, network);
  const projectionB = await canonicalProjection(db, network);

  console.log("[compare]");
  assert(
    projectionA === projectionB,
    "incremental-after-reorg === clean-reindex (incl. listings + trades)",
  );

  console.log("✅ DB reorg integration test PASSED");
  await resetAllTables(db);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
