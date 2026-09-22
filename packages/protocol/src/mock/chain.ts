import { createHash } from "node:crypto";
import type { Sats, TokenAtoms } from "@crclaunch/curve";
import {
  PUBLIC_SUPPLY_ATOMS,
  RESERVE_SUPPLY_ATOMS,
  TOTAL_SUPPLY_ATOMS,
  getStageForSupply,
} from "@crclaunch/curve";
import type { Network } from "@crclaunch/config";
import type { ProtocolEventType } from "../types.js";
import type {
  MockBlock,
  MockChainState,
  MockEvent,
  MockListing,
  MockToken,
  MockTx,
  WalletBalance,
} from "./types.js";

export const MOCK_FAUCET_SATS: Sats = 10n * 100_000_000n; // 10 BTC

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function createInitialState(network: Network): MockChainState {
  return {
    network,
    height: 0n,
    blocks: [],
    mempool: [],
    txs: {},
    tokens: {},
    tickerIndex: {},
    balances: {},
    listings: {},
    events: {},
    platformTreasurySats: 0n,
    protocolTreasurySats: 0n,
  };
}

export function ensureWallet(state: MockChainState, address: string): WalletBalance {
  let bal = state.balances[address];
  if (!bal) {
    bal = { btcSats: MOCK_FAUCET_SATS, tokens: {}, lockedTokens: {} };
    state.balances[address] = bal;
  }
  return bal;
}

export function getStateHash(state: MockChainState): string {
  // Hash only MATERIAL protocol state (token supply/status/stage). A new empty
  // block must not invalidate a quote; only supply-relevant changes do.
  const summary = Object.values(state.tokens)
    .map((t) => `${t.deploymentId}:${t.confirmedMintedAtoms}:${t.status}:${t.currentStage}`)
    .sort()
    .join("|");
  return sha256(summary);
}

export function mineBlock(state: MockChainState): MockBlock {
  const prevHash = state.blocks.length > 0 ? state.blocks[state.blocks.length - 1]!.hash : "genesis";
  const height = state.height + 1n;
  const hash = sha256(`mock:block:${height}:${prevHash}`);
  const block: MockBlock = { height, hash, parentHash: prevHash, txids: [] };

  // Expire listings at/before this height.
  for (const listing of Object.values(state.listings)) {
    if (listing.status === "OPEN" && height >= listing.expiryHeight) {
      listing.status = "EXPIRED";
    }
  }

  const pending = state.mempool.slice();
  state.mempool = [];
  for (const txid of pending) {
    const tx = state.txs[txid];
    if (!tx) continue;
    const result = applyTx(state, tx, height, hash);
    if (result === "CONFIRMED") {
      block.txids.push(tx.txid);
    }
  }

  state.blocks.push(block);
  state.height = height;
  return block;
}

function emitEvent(
  state: MockChainState,
  tx: MockTx,
  blockHeight: bigint,
  blockHash: string,
  eventType: ProtocolEventType,
  fields: {
    deploymentId?: string | null;
    walletFrom?: string | null;
    walletTo?: string | null;
    tokenAmountAtoms?: TokenAtoms | null;
    btcAmountSats?: Sats | null;
    payload?: unknown;
  },
): void {
  const key = `${tx.txid}:0`;
  const event: MockEvent = {
    network: state.network,
    blockHeight,
    blockHash,
    txid: tx.txid,
    eventIndex: 0,
    eventType,
    deploymentId: fields.deploymentId ?? null,
    walletFrom: fields.walletFrom ?? null,
    walletTo: fields.walletTo ?? null,
    tokenAmountAtoms: fields.tokenAmountAtoms ?? null,
    btcAmountSats: fields.btcAmountSats ?? null,
    payload: fields.payload ?? null,
    canonical: true,
  };
  state.events[key] = event;
}

function applyTx(
  state: MockChainState,
  tx: MockTx,
  blockHeight: bigint,
  blockHash: string,
): "CONFIRMED" | "REJECTED" {
  const ok = applyEffects(state, tx, blockHeight, blockHash);
  if (!ok) {
    tx.status = "REJECTED";
    tx.confirmHeight = null;
    return "REJECTED";
  }
  tx.status = "CONFIRMED";
  tx.confirmHeight = blockHeight;
  return "CONFIRMED";
}

function reject(tx: MockTx, reason: string): false {
  tx.status = "REJECTED";
  tx.rejectReason = reason;
  return false;
}

/**
 * Applies a tx's effects to derived state (no event emission). Returns false if
 * the tx is invalid and must be rejected. Must be deterministic for reorg replay.
 */
function applyEffects(
  state: MockChainState,
  tx: MockTx,
  blockHeight: bigint,
  blockHash: string,
): boolean {
  switch (tx.op) {
    case "DEPLOY": {
      const p = tx.payload;
      const tickerNorm = (p.ticker ?? "").toUpperCase();
      if (state.tickerIndex[tickerNorm]) {
        return reject(tx, "TICKER_TAKEN");
      }
      const creator = tx.signer ?? p.creatorAddress ?? "";
      const wallet = ensureWallet(state, creator);
      const launchFee = p.launchFeeSats ?? 0n;
      const totalCost = launchFee + tx.feeSats;
      if (wallet.btcSats < totalCost) return reject(tx, "INSUFFICIENT_BTC");

      wallet.btcSats -= totalCost;
      if (p.treasuryAddress) {
        ensureWallet(state, p.treasuryAddress).btcSats += launchFee;
      }
      state.platformTreasurySats += launchFee;

      const token: MockToken = {
        deploymentId: tx.txid,
        ticker: p.ticker ?? "",
        tickerNormalized: tickerNorm,
        name: p.name ?? null,
        creatorAddress: creator,
        network: state.network,
        totalSupplyAtoms: TOTAL_SUPPLY_ATOMS,
        publicSupplyAtoms: PUBLIC_SUPPLY_ATOMS,
        reserveSupplyAtoms: RESERVE_SUPPLY_ATOMS,
        confirmedMintedAtoms: 0n,
        pendingMintedAtoms: 0n,
        currentStage: 1,
        deployHeight: blockHeight,
        status: "LIVE",
        reserveSats: 0n,
        lastTradePricePerMillion: null,
      };
      state.tokens[tx.txid] = token;
      state.tickerIndex[tickerNorm] = tx.txid;
      emitEvent(state, tx, blockHeight, blockHash, "DEPLOY", {
        deploymentId: tx.txid,
        walletFrom: creator,
        btcAmountSats: launchFee,
        payload: { ticker: p.ticker, name: p.name },
      });
      return true;
    }

    case "MINT": {
      const p = tx.payload;
      const token = state.tokens[p.deploymentId ?? ""];
      if (!token) return reject(tx, "TOKEN_NOT_FOUND");
      if (token.status === "SOLD_OUT" || token.status === "GRADUATED" || token.status === "GRADUATING") {
        return reject(tx, "MINT_SOLD_OUT");
      }
      if (token.confirmedMintedAtoms !== (p.supplyBeforeAtoms ?? 0n)) {
        return reject(tx, "SUPPLY_CHANGED");
      }
      const amount = p.tokenAmountAtoms ?? 0n;
      if (amount <= 0n) return reject(tx, "ZERO_QUANTITY");
      if (token.confirmedMintedAtoms + amount > PUBLIC_SUPPLY_ATOMS) {
        return reject(tx, "EXCEEDS_REMAINING_SUPPLY");
      }

      const buyer = tx.signer ?? p.buyerAddress ?? "";
      const wallet = ensureWallet(state, buyer);
      const curve = p.curveContributionSats ?? 0n;
      const platform = p.platformFeeSats ?? 0n;
      const miner = p.minerFeeSats ?? 0n;
      const total = curve + platform + miner;
      if (wallet.btcSats < total) return reject(tx, "INSUFFICIENT_BTC");

      wallet.btcSats -= total;
      wallet.tokens[token.deploymentId] =
        (wallet.tokens[token.deploymentId] ?? 0n) + amount;
      token.reserveSats += curve;
      if (p.treasuryAddress) {
        ensureWallet(state, p.treasuryAddress).btcSats += platform;
      }
      state.platformTreasurySats += platform;
      token.confirmedMintedAtoms += amount;
      token.currentStage = getStageForSupply(token.confirmedMintedAtoms);
      if (token.confirmedMintedAtoms >= PUBLIC_SUPPLY_ATOMS) {
        token.status = "SOLD_OUT";
      }
      emitEvent(state, tx, blockHeight, blockHash, "MINT", {
        deploymentId: token.deploymentId,
        walletFrom: buyer,
        walletTo: buyer,
        tokenAmountAtoms: amount,
        btcAmountSats: curve,
        payload: { platformFeeSats: platform, minerFeeSats: miner },
      });
      return true;
    }

    case "TRANSFER": {
      const p = tx.payload;
      const from = tx.signer ?? "";
      const to = p.buyerAddress ?? p.sellerAddress ?? "";
      const amount = p.tokenAmountAtoms ?? 0n;
      const fromWallet = ensureWallet(state, from);
      if ((fromWallet.tokens[p.deploymentId ?? ""] ?? 0n) < amount) {
        return reject(tx, "INSUFFICIENT_TOKENS");
      }
      fromWallet.tokens[p.deploymentId ?? ""] = (fromWallet.tokens[p.deploymentId ?? ""] ?? 0n) - amount;
      ensureWallet(state, to).tokens[p.deploymentId ?? ""] =
        (ensureWallet(state, to).tokens[p.deploymentId ?? ""] ?? 0n) + amount;
      emitEvent(state, tx, blockHeight, blockHash, "TRANSFER", {
        deploymentId: p.deploymentId,
        walletFrom: from,
        walletTo: to,
        tokenAmountAtoms: amount,
      });
      return true;
    }

    case "DEX_ASK": {
      const p = tx.payload;
      const token = state.tokens[p.deploymentId ?? ""];
      if (!token) return reject(tx, "TOKEN_NOT_FOUND");
      if (token.status !== "GRADUATED") return reject(tx, "NOT_GRADUATED");
      const seller = tx.signer ?? p.sellerAddress ?? "";
      const amount = p.tokenAmountAtoms ?? 0n;
      if (amount <= 0n) return reject(tx, "ZERO_QUANTITY");
      const wallet = ensureWallet(state, seller);
      const available = (wallet.tokens[token.deploymentId] ?? 0n) - (wallet.lockedTokens[token.deploymentId] ?? 0n);
      if (available < amount) return reject(tx, "INSUFFICIENT_TOKENS");
      wallet.lockedTokens[token.deploymentId] = (wallet.lockedTokens[token.deploymentId] ?? 0n) + amount;
      const listing: MockListing = {
        id: tx.txid,
        deploymentId: token.deploymentId,
        sellerAddress: seller,
        tokenAmountAtoms: amount,
        askingPriceSats: p.askingPriceSats ?? 0n,
        creationHeight: blockHeight,
        expiryHeight: p.expiryHeight ?? blockHeight + 144n,
        status: "OPEN",
      };
      state.listings[listing.id] = listing;
      emitEvent(state, tx, blockHeight, blockHash, "DEX_ASK", {
        deploymentId: token.deploymentId,
        walletFrom: seller,
        tokenAmountAtoms: amount,
        btcAmountSats: listing.askingPriceSats,
        payload: { listingId: listing.id, expiryHeight: listing.expiryHeight },
      });
      return true;
    }

    case "DEX_BID": {
      const p = tx.payload;
      const listing = state.listings[p.listingId ?? ""];
      if (!listing) return reject(tx, "LISTING_NOT_FOUND");
      if (listing.status !== "OPEN") return reject(tx, "LISTING_ALREADY_TAKEN");
      if (blockHeight >= listing.expiryHeight) return reject(tx, "LISTING_EXPIRED");
      const buyer = tx.signer ?? p.buyerAddress ?? "";
      const wallet = ensureWallet(state, buyer);
      const totalPrice = p.totalPriceSats ?? 0n;
      const protocolFee = p.protocolFeeSats ?? 0n;
      const platformFee = p.platformFeeSats ?? 0n;
      const miner = p.minerFeeSats ?? 0n;
      const buyerCost = totalPrice + protocolFee + platformFee + miner;
      if (wallet.btcSats < buyerCost) return reject(tx, "INSUFFICIENT_BTC");

      wallet.btcSats -= buyerCost;
      ensureWallet(state, listing.sellerAddress).btcSats += totalPrice;
      if (p.treasuryAddress) {
        ensureWallet(state, p.treasuryAddress).btcSats += platformFee;
      }
      state.platformTreasurySats += platformFee;
      state.protocolTreasurySats += protocolFee;

      // Move locked tokens from seller to buyer.
      const sellerWallet = ensureWallet(state, listing.sellerAddress);
      sellerWallet.tokens[listing.deploymentId] =
        (sellerWallet.tokens[listing.deploymentId] ?? 0n) - listing.tokenAmountAtoms;
      sellerWallet.lockedTokens[listing.deploymentId] =
        (sellerWallet.lockedTokens[listing.deploymentId] ?? 0n) - listing.tokenAmountAtoms;
      wallet.tokens[listing.deploymentId] =
        (wallet.tokens[listing.deploymentId] ?? 0n) + listing.tokenAmountAtoms;
      listing.status = "TAKEN";

      const token = state.tokens[listing.deploymentId];
      if (token) {
        token.lastTradePricePerMillion =
          (listing.askingPriceSats * 1_000_000n) / listing.tokenAmountAtoms;
      }
      emitEvent(state, tx, blockHeight, blockHash, "DEX_BID", {
        deploymentId: listing.deploymentId,
        walletFrom: buyer,
        walletTo: listing.sellerAddress,
        tokenAmountAtoms: listing.tokenAmountAtoms,
        btcAmountSats: totalPrice,
        payload: { listingId: listing.id, protocolFeeSats: protocolFee, platformFeeSats: platformFee },
      });
      return true;
    }

    case "DEX_CANCEL": {
      const p = tx.payload;
      const listing = state.listings[p.listingId ?? ""];
      if (!listing) return reject(tx, "LISTING_NOT_FOUND");
      if (listing.status !== "OPEN") return reject(tx, "LISTING_NOT_CANCELLABLE");
      const seller = tx.signer ?? p.sellerAddress ?? "";
      if (listing.sellerAddress !== seller) return reject(tx, "NOT_LISTING_OWNER");
      const wallet = ensureWallet(state, seller);
      wallet.lockedTokens[listing.deploymentId] =
        (wallet.lockedTokens[listing.deploymentId] ?? 0n) - listing.tokenAmountAtoms;
      listing.status = "CANCELLED";
      emitEvent(state, tx, blockHeight, blockHash, "DEX_CANCEL", {
        deploymentId: listing.deploymentId,
        walletFrom: seller,
        tokenAmountAtoms: listing.tokenAmountAtoms,
        payload: { listingId: listing.id },
      });
      return true;
    }

    case "GRADUATION": {
      const p = tx.payload;
      const token = state.tokens[p.deploymentId ?? ""];
      if (!token) return reject(tx, "TOKEN_NOT_FOUND");
      if (token.confirmedMintedAtoms < PUBLIC_SUPPLY_ATOMS) {
        return reject(tx, "NOT_SOLD_OUT");
      }
      if (token.status !== "SOLD_OUT" && token.status !== "GRADUATING") {
        return reject(tx, "NOT_GRADUATABLE");
      }
      token.status = "GRADUATED";
      emitEvent(state, tx, blockHeight, blockHash, "GRADUATION", {
        deploymentId: token.deploymentId,
        btcAmountSats: token.reserveSats,
        payload: { reserveSats: token.reserveSats },
      });
      return true;
    }

    default:
      return reject(tx, "UNSUPPORTED_OPERATION");
  }
}

export function rebuildDerivedState(state: MockChainState): void {
  state.tokens = {};
  state.tickerIndex = {};
  state.balances = {};
  state.listings = {};
  state.platformTreasurySats = 0n;
  state.protocolTreasurySats = 0n;
  for (const block of state.blocks) {
    for (const txid of block.txids) {
      const tx = state.txs[txid];
      if (tx) {
        tx.status = "CONFIRMED";
        tx.confirmHeight = block.height;
        tx.rejectReason = null;
        applyEffects(state, tx, block.height, block.hash);
      }
    }
  }
}

export function reorg(state: MockChainState, depth: number): MockBlock[] {
  if (depth <= 0) return [];
  const removed = state.blocks.splice(-depth, depth);
  for (const block of removed) {
    for (const txid of block.txids) {
      const tx = state.txs[txid];
      if (tx) {
        tx.status = "MEMPOOL";
        tx.confirmHeight = null;
        tx.rejectReason = null;
        state.mempool.push(txid);
      }
      // Mark this tx's event as non-canonical (forensics only).
      const ev = state.events[`${txid}:0`];
      if (ev) ev.canonical = false;
    }
  }
  state.height -= BigInt(removed.length);
  rebuildDerivedState(state);
  return removed;
}

export function getConfirmedEvents(state: MockChainState): MockEvent[] {
  return Object.values(state.events)
    .filter((e) => e.canonical)
    .sort((a, b) => (a.blockHeight < b.blockHeight ? -1 : a.blockHeight > b.blockHeight ? 1 : 0));
}

export function getEventsInRange(state: MockChainState, from: bigint, to: bigint): MockEvent[] {
  return getConfirmedEvents(state).filter((e) => e.blockHeight >= from && e.blockHeight <= to);
}
