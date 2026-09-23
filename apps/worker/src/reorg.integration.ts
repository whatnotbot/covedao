import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

import { loadConfig } from "@crclaunch/config";
import { createDb, resetAllTables, schema, type Database } from "@crclaunch/db";
import { MockChainNode, MemoryStorage, MockCRCAdapter, MOCK_TREASURY_ADDRESS } from "@crclaunch/protocol";
import { quoteExactTokens, computePlatformFee } from "@crclaunch/curve";
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
    .map((t) => `${t.deploymentTxid}:${t.ticker}:${t.status}:${t.confirmedMintedAtoms}:${t.currentStage}:${t.reserveSats}:${t.lastTradePricePerMillion ?? "null"}`)
    .sort();
  const balances = (await db.select().from(schema.walletTokenBalances).execute())
    .filter((b) => b.network === network)
    .map((b) => `${b.walletAddress}:${b.deploymentId}:${b.balanceAtoms}:${b.lockedAtoms}`)
    .sort();
  const listings = (await db.select().from(schema.listings).execute())
    .filter((l) => l.network === network)
    .map((l) => `${l.listingId}:${l.status}:${l.tokenAmountAtoms}:${l.askingPriceSats}`)
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
  return JSON.stringify({ tokens, balances, listings, mints, events, blocks });
}

const CREATOR = "bc1qm0ckcreator00000000000000000000000000000000000000";
const BUYER = "bc1qm0ckbuyer0000000000000000000000000000000000000000";

async function deployFrog(node: MockChainNode, adapter: MockCRCAdapter): Promise<string> {
  const d = await adapter.buildDeploy({
    ticker: "FROG", name: "Frog", creatorAddress: CREATOR, treasuryAddress: MOCK_TREASURY_ADDRESS, launchFeeSats: 10_000n, network: node.snapshot.network,
  });
  await adapter.broadcast(`${d.psbtBase64}\nMOCK-SIGNED-BY:${CREATOR}`);
  return (await adapter.getTokenByTicker("FROG"))?.deploymentId ?? "";
}

async function mintFrog(node: MockChainNode, adapter: MockCRCAdapter, amount: bigint): Promise<void> {
  const frog = (await node.getAllTokens()).find((t) => t.ticker === "FROG")!;
  const q = quoteExactTokens({ desiredTokens: amount, currentSupply: frog.confirmedMintedAtoms });
  const m = await adapter.buildMint({
    deploymentId: frog.deploymentId,
    ticker: frog.ticker,
    buyerAddress: BUYER,
    treasuryAddress: MOCK_TREASURY_ADDRESS,
    tokenAmountAtoms: amount,
    curveContributionSats: q.curveContributionSats,
    platformFeeSats: computePlatformFee(q.curveContributionSats, 100n),
    minerFeeSats: 450n,
    currentSupplyAtoms: frog.confirmedMintedAtoms,
    stateHash: await node.getStateHash(),
  });
  await adapter.broadcast(`${m.psbtBase64}\nMOCK-SIGNED-BY:${BUYER}`);
}

async function main() {
  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl);
  const network = config.network;
  console.log("=== DB reorg integration test ===");

  // ONE canonical node — both DB A (incremental+reorg) and DB B (clean reindex)
  // are projections of the SAME node state, so txids/blocks are identical.
  const node = new MockChainNode(new MemoryStorage(), network);
  await node.init();
  const adapter = new MockCRCAdapter(node);

  await resetAllTables(db);
  await deployFrog(node, adapter);
  await node.mineBlock();
  await syncMockToDb(db, node, network);
  const frog0 = (await db.select().from(schema.tokens).execute()).filter((t) => t.ticker === "FROG")[0];
  assert(frog0 !== undefined && frog0.confirmedMintedAtoms === 0n, "FROG deployed, 0 minted");

  // Mint 10M, mine, sync incrementally.
  await mintFrog(node, adapter, 10_000_000n);
  await node.mineBlock();
  await syncMockToDb(db, node, network);
  const frog1 = (await db.select().from(schema.tokens).execute()).filter((t) => t.ticker === "FROG")[0];
  assert(frog1!.confirmedMintedAtoms === 10_000_000n, "mint increased supply to 10M");

  // Reorg away the mint block.
  await node.reorg(1);
  const reorged = await detectReorg(db, node, network);
  assert(reorged, "reorg detected via stored block history");
  await rebuildProjections(db, node, network);
  const frog2 = (await db.select().from(schema.tokens).execute()).filter((t) => t.ticker === "FROG")[0];
  assert(frog2!.confirmedMintedAtoms === 0n, "supply rolled back to 0 after reorg");
  const projectionA = await canonicalProjection(db, network);

  // Clean reindex: truncate everything and re-sync the SAME canonical node state.
  await resetAllTables(db);
  await syncMockToDb(db, node, network);
  const projectionB = await canonicalProjection(db, network);

  console.log("[compare]");
  assert(projectionA === projectionB, "incremental-after-reorg === clean-reindex");

  console.log("✅ DB reorg integration test PASSED");
  await resetAllTables(db);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
