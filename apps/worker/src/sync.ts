import type { Database } from "@crclaunch/db";
import {
  getTokenByDeployment,
  insertDraftToken,
  insertListing,
  insertMint,
  insertReorgEvent,
  insertTrade,
  updateTokenState,
  upsertBalance,
  upsertChainEvent,
  getCursor,
  setCursor,
  canTransition,
  setTokenStatus,
  getListingById,
  forceSetListingStatus,
  upsertBlock,
  markEventsNonCanonicalExcept,
  markMintsNonCanonicalExcept,
  markTradesNonCanonicalExcept,
} from "@crclaunch/db";
import type { MockChainNode, MockCRCAdapter } from "@crclaunch/protocol";
import type { RuntimeConfig } from "@crclaunch/config";
import { PUBLIC_SUPPLY_TOKENS, TOTAL_SUPPLY_TOKENS, GRADUATION_RESERVE_TOKENS } from "@crclaunch/curve";
import type { TokenStatus } from "@crclaunch/db";
import {
  getBlock,
  resetProjections,
} from "@crclaunch/db";

const CURSOR_ID = "mock-indexer";

/**
 * Detect a reorg by comparing the stored canonical block hash at the cursor
 * height against the node's current hash, walking back through STORED block
 * history to find the common ancestor (P0.1 #23). Returns true when a reorg
 * occurred, and records a reorg event for forensics.
 */
export async function detectReorg(db: Database, node: MockChainNode, network: string): Promise<boolean> {
  const cursor = await getCursor(db, CURSOR_ID);
  if (!cursor || cursor.lastHeight <= 0n) return false;

  const storedTip = await getBlock(db, network, cursor.lastHeight);
  if (!storedTip) return false; // no canonical block history stored yet

  const currentHash = await node.getBlockHash(cursor.lastHeight);
  if (currentHash === storedTip.hash) return false;

  let h = cursor.lastHeight;
  while (h > 0n) {
    const stored = await getBlock(db, network, h);
    const current = await node.getBlockHash(h);
    if (stored && stored.hash === current) break;
    h -= 1n;
  }

  await insertReorgEvent(db, {
    network,
    fromHeight: h + 1n,
    toHeight: cursor.lastHeight,
    orphanedBlockHash: storedTip.hash,
    details: { detectedTip: currentHash },
  });
  return true;
}

/**
 * Rebuild the materialized projection from the canonical mock chain. The chain
 * is the source of truth; the DB is a projection/cache, so a deterministic
 * rebuild is the simplest correct reconciliation (P0.1 #15).
 */
export async function rebuildProjections(db: Database, node: MockChainNode, network: string): Promise<void> {
  await resetProjections(db);
  await syncMockToDb(db, node, network);
}

export async function syncMockToDb(db: Database, node: MockChainNode, network: string): Promise<void> {
  const height = await node.getHeight();
  const chainTokens = await node.getAllTokens();
  const chainListings = await node.getListings();
  const chainBalances = await node.getAllBalances();
  const events = await node.getEvents(0n, height);
  const stateHash = await node.getStateHash();

  await db.transaction(async (tx) => {
    for (const mt of chainTokens) {
      const target = mt.status as TokenStatus;
      const existing = await getTokenByDeployment(tx, network, mt.deploymentId);
      if (!existing) {
        const row = await insertDraftToken(tx, {
          deploymentTxid: mt.deploymentId,
          ticker: mt.ticker,
          tickerNormalized: mt.tickerNormalized,
          name: mt.name ?? mt.ticker,
          creatorAddress: mt.creatorAddress,
          network,
          status: target,
          totalSupplyAtoms: TOTAL_SUPPLY_TOKENS,
          publicSupplyAtoms: PUBLIC_SUPPLY_TOKENS,
          reserveSupplyAtoms: GRADUATION_RESERVE_TOKENS,
        });
        await updateTokenState(tx, row.id, {
          confirmedMintedAtoms: mt.confirmedMintedAtoms,
          pendingMintedAtoms: mt.pendingMintedAtoms,
          currentStage: mt.currentStage,
          protocolStateHash: stateHash,
          reserveSats: mt.reserveSats,
          lastTradePricePerMillion: mt.lastTradePricePerMillion,
        });
      } else {
        const current = existing.status as TokenStatus;
        if (current !== target) {
          const legal =
            canTransition(current, target) ||
            current === "DEPLOY_PENDING" ||
            current === "DEPLOY_BROADCAST";
          if (legal) {
            await setTokenStatus(tx, existing.id, current, target);
          }
        }
        await updateTokenState(tx, existing.id, {
          confirmedMintedAtoms: mt.confirmedMintedAtoms,
          pendingMintedAtoms: mt.pendingMintedAtoms,
          currentStage: mt.currentStage,
          protocolStateHash: stateHash,
          reserveSats: mt.reserveSats,
          lastTradePricePerMillion: mt.lastTradePricePerMillion,
        });
      }
    }

    for (const l of chainListings) {
      const status = listingStatus(l.status);
      const existing = await getListingById(tx, l.id);
      if (!existing) {
        await insertListing(tx, {
          listingId: l.id,
          network,
          deploymentId: l.deploymentId,
          sellerAddress: l.sellerAddress,
          tokenAmountAtoms: l.tokenAmountAtoms,
          askingPriceSats: l.askingPriceSats,
          creationHeight: l.creationHeight,
          expiryHeight: l.expiryHeight,
          status,
          txid: l.id,
        });
      } else if (existing.status !== status) {
        // Chain is authoritative; reconcile idempotently.
        await forceSetListingStatus(tx, l.id, status);
      }
    }

    for (const b of chainBalances) {
      for (const [deploymentId, amount] of Object.entries(b.tokens)) {
        await upsertBalance(tx, {
          network,
          walletAddress: b.address,
          deploymentId,
          balanceAtoms: amount,
          lockedAtoms: b.lockedTokens[deploymentId] ?? 0n,
        });
      }
    }

    for (const e of events) {
      await upsertChainEvent(tx, {
        network,
        blockHeight: e.blockHeight,
        blockHash: e.blockHash,
        txid: e.txid,
        eventIndex: e.eventIndex,
        eventType: e.eventType,
        deploymentId: e.deploymentId,
        walletFrom: e.walletFrom,
        walletTo: e.walletTo,
        tokenAmountAtoms: e.tokenAmountAtoms,
        btcAmountSats: e.btcAmountSats,
        payloadJson: e.payload,
        canonical: true,
      });

      if (e.eventType === "DEX_BID" && e.tokenAmountAtoms && e.btcAmountSats) {
        const payload = (e.payload ?? {}) as { listingId?: string; protocolFeeSats?: string | bigint; platformFeeSats?: string | bigint };
        await insertTrade(tx, {
          network,
          deploymentId: e.deploymentId ?? "",
          listingId: payload.listingId ?? "",
          buyerAddress: e.walletFrom ?? "",
          sellerAddress: e.walletTo ?? "",
          tokenAmountAtoms: e.tokenAmountAtoms,
          priceSats: e.btcAmountSats,
          pricePerMillionSats: (e.btcAmountSats * 1_000_000n) / e.tokenAmountAtoms,
          protocolFeeSats: toBigInt(payload.protocolFeeSats),
          platformFeeSats: toBigInt(payload.platformFeeSats),
          txid: e.txid,
          blockHeight: e.blockHeight,
        });
      }

      if (e.eventType === "MINT" && e.tokenAmountAtoms) {
        const payload = (e.payload ?? {}) as { platformFeeSats?: string | bigint; minerFeeSats?: string | bigint };
        await insertMint(tx, {
          network,
          deploymentId: e.deploymentId ?? "",
          walletAddress: e.walletFrom ?? "",
          tokenAmountAtoms: e.tokenAmountAtoms,
          curveContributionSats: e.btcAmountSats ?? 0n,
          platformFeeSats: toBigInt(payload.platformFeeSats),
          minerFeeSats: toBigInt(payload.minerFeeSats),
          txid: e.txid,
          status: "INDEXED",
          blockHeight: e.blockHeight,
        });
      }
    }
  });

  // ── Canonical block history + reorg reconciliation (P0-26/27/28) ──────────
  const blocks = await node.getBlocks();
  const canonicalTxids = await node.getCanonicalTxids();
  await db.transaction(async (tx) => {
    for (const b of blocks) {
      await upsertBlock(tx, { network, height: b.height, hash: b.hash, parentHash: b.parentHash, canonical: true });
    }
    await markEventsNonCanonicalExcept(tx, network, canonicalTxids);
    await markMintsNonCanonicalExcept(tx, network, canonicalTxids);
    await markTradesNonCanonicalExcept(tx, network, canonicalTxids);
  });

  await setCursor(db, CURSOR_ID, network, height, await node.getBlockHash(height));
}

export async function maybeGraduate(
  db: Database,
  node: MockChainNode,
  adapter: MockCRCAdapter,
  config: RuntimeConfig,
  network: string,
): Promise<void> {
  const height = await node.getHeight();
  const events = await node.getEvents(0n, height);
  const chainTokens = await node.getAllTokens();

  for (const mt of chainTokens) {
    if (mt.status !== "SOLD_OUT") continue;
    const row = await getTokenByDeployment(db, network, mt.deploymentId);
    if (!row || row.status !== "SOLD_OUT") continue;
    const lastMint = events
      .filter((e) => e.deploymentId === mt.deploymentId && e.eventType === "MINT")
      .at(-1);
    if (!lastMint) continue;
    const confirmations = Number(height - lastMint.blockHeight + 1n);
    if (confirmations >= config.finalityConfirmations) {
      await setTokenStatus(db, row.id, "SOLD_OUT", "GRADUATING");
      await adapter.graduate(mt.deploymentId);
    }
  }
}

function listingStatus(s: string): "OPEN" | "TAKEN" | "CANCELLED" | "EXPIRED" {
  if (s === "TAKEN") return "TAKEN";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "EXPIRED") return "EXPIRED";
  return "OPEN";
}

function toBigInt(v: string | bigint | undefined | null): bigint {
  if (v === undefined || v === null) return 0n;
  if (typeof v === "bigint") return v;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}
