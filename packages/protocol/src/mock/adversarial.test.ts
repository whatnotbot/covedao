import { describe, expect, it, beforeAll } from "vitest";
import { MemoryStorage } from "./store.js";
import { MockChainNode } from "./node.js";
import { MockCRCAdapter } from "./adapter.js";
import { buildEnvelope, envelopeToPsbt } from "./envelope.js";
import { quoteExactTokens, computePlatformFee } from "@crclaunch/curve";
import { assertProtocolInvariants } from "./chain.js";
import {
  MOCK_RESERVE_ADDRESS,
  MOCK_TREASURY_ADDRESS,
} from "../validation/config.js";
import type { MockTxEnvelope } from "./types.js";

const CREATOR = "bc1qm0ckcreator00000000000000000000000000000000000000";
const BUYER = "bc1qm0ckbuyer0000000000000000000000000000000000000000";
const ATTACKER = "bc1qm0ckattacker00000000000000000000000000000000000000";

let node: MockChainNode;
let adapter: MockCRCAdapter;
let frogId: string;

function sign(env: MockTxEnvelope, signer: string): string {
  return `${envelopeToPsbt(env)}\nMOCK-SIGNED-BY:${signer}`;
}

/** Build a raw (untrusted) mint envelope with arbitrary outputs. */
function mintEnvelope(opts: {
  deploymentId: string;
  ticker?: string;
  buyer?: string;
  amount: bigint;
  supplyBefore: bigint;
  curveAddr?: string;
  curveAmt: bigint;
  platformAddr?: string;
  platformAmt: bigint;
  feeSats?: bigint;
}): MockTxEnvelope {
  return buildEnvelope({
    op: "MINT",
    network: "mock",
    payload: {
      deploymentId: opts.deploymentId,
      ticker: opts.ticker ?? "FROG",
      buyerAddress: opts.buyer ?? BUYER,
      tokenAmountAtoms: opts.amount,
      supplyBeforeAtoms: opts.supplyBefore,
      curveContributionSats: 999_999n, // claimed (must be ignored)
      platformFeeSats: 999_999n, // claimed (must be ignored)
      minerFeeSats: 0n,
    },
    inputs: [{ txid: "mock-utxo", vout: 0, address: opts.buyer ?? BUYER, amountSats: 1_000_000_000n }],
    outputs: [
      { index: 0, address: opts.curveAddr ?? MOCK_RESERVE_ADDRESS, amountSats: opts.curveAmt, kind: "curve-reserve" },
      { index: 1, address: opts.platformAddr ?? MOCK_TREASURY_ADDRESS, amountSats: opts.platformAmt, kind: "platform-fee" },
    ],
    feeSats: opts.feeSats ?? 300n,
    stateHash: "",
    expiresAtHeight: 1000n,
    expiresAtTimestamp: new Date(Date.now() + 120_000).toISOString(),
  });
}

async function submit(env: MockTxEnvelope, signer: string): Promise<{ status: string; reason: string | null }> {
  await adapter.broadcast(sign(env, signer));
  await node.mineBlock();
  const tx = await node.getMockTx(env.txid);
  return { status: tx?.status ?? "UNKNOWN", reason: tx?.rejectReason ?? null };
}

function snapshot() {
  const t = node.snapshot.tokens[frogId];
  const buyerBal = node.snapshot.balances[BUYER];
  return {
    minted: t?.confirmedMintedAtoms,
    reserve: t?.reserveSats,
    buyerTokens: buyerBal?.tokens[frogId] ?? 0n,
    platform: node.snapshot.platformTreasurySats,
    invariants: assertProtocolInvariants(node.snapshot),
  };
}

// For 2,000,000 tokens from supply 0: required curve = 1000 sats, platform = 10 sats.
const VALID = { amount: 2_000_000n, curve: 1_000n, platform: 10n };

describe("adversarial mint validation (tampered envelopes, no builder)", () => {
  beforeAll(async () => {
    node = new MockChainNode(new MemoryStorage(), "mock");
    await node.init();
    adapter = new MockCRCAdapter(node);
    const deploy = await adapter.buildDeploy({
      ticker: "FROG", name: "Frog", creatorAddress: CREATOR, treasuryAddress: MOCK_TREASURY_ADDRESS, launchFeeSats: 10_000n, network: "mock",
    });
    await adapter.broadcast(`${deploy.psbtBase64}\nMOCK-SIGNED-BY:${CREATOR}`);
    await node.mineBlock();
    frogId = (await adapter.getTokenByTicker("FROG"))!.deploymentId;
  });

  it("baseline: valid mint accepted and updates state", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: 0n, curveAmt: VALID.curve, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("CONFIRMED");
    const after = snapshot();
    expect(after.minted).toBe(2_000_000n);
    expect(after.buyerTokens).toBe(2_000_000n);
    expect(after.reserve).toBe(1_000n);
    expect(after.platform).toBe(before.platform + 10n);
    expect(after.invariants).toEqual([]);
  });

  it("underpayment by 1 sat rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve - 1n, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("UNDERPAYMENT");
    expect(snapshot()).toEqual(before);
  });

  it("underpayment by 50% rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve / 2n, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(snapshot()).toEqual(before);
  });

  it("claimed payment ignored; omitted reserve output rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: 1n, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(snapshot()).toEqual(before);
  });

  it("correct amount to wrong reserve address rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAddr: ATTACKER, curveAmt: VALID.curve, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INVALID_OUTPUT_LAYOUT");
    expect(snapshot()).toEqual(before);
  });

  it("platform fee to attacker treasury rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAddr: ATTACKER, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INVALID_OUTPUT_LAYOUT");
    expect(snapshot()).toEqual(before);
  });

  it("platform fee underpayment rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAmt: VALID.platform - 1n }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("FEE_UNDERPAYMENT");
    expect(snapshot()).toEqual(before);
  });

  it("overmint beyond remaining supply rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: 839_999_999n, supplyBefore: before.minted!, curveAmt: 99_999_999n, platformAmt: 0n }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("EXCEEDS_REMAINING_SUPPLY");
    expect(snapshot()).toEqual(before);
  });

  it("zero amount rejected", async () => {
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: 0n, supplyBefore: snapshot().minted!, curveAmt: 0n, platformAmt: 0n }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("ZERO_QUANTITY");
  });

  it("wrong ticker rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, ticker: "EVIL", amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("TICKER_MISMATCH");
    expect(snapshot()).toEqual(before);
  });

  it("unknown deployment rejected", async () => {
    const r = await submit(mintEnvelope({ deploymentId: "does-not-exist", amount: VALID.amount, supplyBefore: 0n, curveAmt: VALID.curve, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("TOKEN_NOT_FOUND");
  });

  it("stale supply rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted! + 1n, curveAmt: VALID.curve, platformAmt: VALID.platform }), BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("SUPPLY_CHANGED");
    expect(snapshot()).toEqual(before);
  });

  it("signer != buyer rejected", async () => {
    const before = snapshot();
    const r = await submit(mintEnvelope({ deploymentId: frogId, buyer: BUYER, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAmt: VALID.platform }), ATTACKER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("SIGNER_MISMATCH");
    expect(snapshot()).toEqual(before);
  });

  it("duplicate curve output rejected (exact layout required)", async () => {
    const before = snapshot();
    const env = mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAmt: VALID.platform });
    env.outputs.push({ index: 2, address: MOCK_RESERVE_ADDRESS, amountSats: 1n, kind: "curve-reserve" });
    const r = await submit(env, BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INVALID_OUTPUT_LAYOUT");
    expect(snapshot()).toEqual(before);
  });

  it("missing platform-fee output rejected (exact layout required)", async () => {
    const before = snapshot();
    const env = mintEnvelope({ deploymentId: frogId, amount: VALID.amount, supplyBefore: before.minted!, curveAmt: VALID.curve, platformAmt: VALID.platform });
    env.outputs = env.outputs.slice(0, 1); // drop platform-fee output
    const r = await submit(env, BUYER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("INVALID_OUTPUT_LAYOUT");
    expect(snapshot()).toEqual(before);
  });
});

describe("adversarial marketplace + deploy validation (tampered envelopes)", () => {
  const SELLER = BUYER;
  let gradId: string;
  let listingId: string;

  function bidEnvelope(opts: { listingId: string; buyer: string; sellerOutAddr: string; sellerOutAmt: bigint; feeSats?: bigint }): MockTxEnvelope {
    return buildEnvelope({
      op: "DEX_BID",
      network: "mock",
      payload: { listingId: opts.listingId, buyerAddress: opts.buyer, totalPriceSats: 1n, protocolFeeSats: 999_999n, platformFeeSats: 999_999n, minerFeeSats: 0n },
      inputs: [{ txid: "mock-utxo", vout: 0, address: opts.buyer, amountSats: 1_000_000_000n }],
      outputs: [{ index: 0, address: opts.sellerOutAddr, amountSats: opts.sellerOutAmt, kind: "seller" }],
      feeSats: opts.feeSats ?? 300n,
      stateHash: "",
      expiresAtHeight: 1000n,
      expiresAtTimestamp: new Date(Date.now() + 120_000).toISOString(),
    });
  }

  function deployEnvelope(ticker: string, creator: string, feeOut: bigint): MockTxEnvelope {
    return buildEnvelope({
      op: "DEPLOY",
      network: "mock",
      payload: { ticker, name: "X", creatorAddress: creator },
      inputs: [{ txid: "mock-utxo", vout: 0, address: creator, amountSats: 1_000_000_000n }],
      outputs: [{ index: 0, address: MOCK_TREASURY_ADDRESS, amountSats: feeOut, kind: "launch-fee" }],
      feeSats: 300n,
      stateHash: "",
      expiresAtHeight: 1000n,
      expiresAtTimestamp: new Date(Date.now() + 120_000).toISOString(),
    });
  }

  beforeAll(async () => {
    // Mint the FROG token's REMAINING supply in one shot, then graduate it.
    const current = node.snapshot.tokens[frogId]!.confirmedMintedAtoms;
    const remaining = 840_000_000n - current;
    const quote = quoteExactTokens({ desiredTokens: remaining, currentSupply: current });
    const fullCurve = quote.curveContributionSats;
    const fullPlatform = computePlatformFee(fullCurve, 100n);
    const env = mintEnvelope({ deploymentId: frogId, amount: remaining, supplyBefore: current, curveAmt: fullCurve, platformAmt: fullPlatform });
    await submit(env, BUYER);
    await adapter.graduate(frogId);
    await node.mineBlock();
    gradId = frogId;

    // Create a real OPEN listing via the adapter (valid path).
    const lb = await adapter.buildSellListing({ deploymentId: gradId, sellerAddress: SELLER, tokenAmountAtoms: 1_000_000n, askingPriceSats: 500_000n, expiryHeight: (await node.getHeight()) + 144n });
    await adapter.broadcast(`${lb.psbtBase64}\nMOCK-SIGNED-BY:${SELLER}`);
    await node.mineBlock();
    listingId = (await adapter.getListings()).find((l) => l.status === "OPEN")!.id;
  });

  it("buyer claims lower price (payload) but output underpays seller → rejected", async () => {
    const before = snapshot();
    const env = bidEnvelope({ listingId, buyer: ATTACKER, sellerOutAddr: SELLER, sellerOutAmt: 1n });
    const r = await submit(env, ATTACKER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("SELLER_UNDERPAYMENT");
    const listing = node.snapshot.listings[listingId];
    expect(listing!.status).toBe("OPEN");
    expect(snapshot()).toEqual(before);
  });

  it("wrong seller address rejected", async () => {
    const before = snapshot();
    const env = bidEnvelope({ listingId, buyer: ATTACKER, sellerOutAddr: ATTACKER, sellerOutAmt: 500_000n });
    const r = await submit(env, ATTACKER);
    expect(r.status).toBe("REJECTED");
    expect(snapshot()).toEqual(before);
  });

  it("double purchase: second buyer rejected (LISTING_ALREADY_TAKEN)", async () => {
    // First buyer (attacker) takes it.
    const b1 = bidEnvelope({ listingId, buyer: ATTACKER, sellerOutAddr: SELLER, sellerOutAmt: 500_000n });
    const r1 = await submit(b1, ATTACKER);
    expect(r1.status).toBe("CONFIRMED");
    // Second buyer races the same listing.
    const b2 = bidEnvelope({ listingId, buyer: CREATOR, sellerOutAddr: SELLER, sellerOutAmt: 500_000n });
    const r2 = await submit(b2, CREATOR);
    expect(r2.status).toBe("REJECTED");
    expect(r2.reason).toBe("LISTING_ALREADY_TAKEN");
    expect(assertProtocolInvariants(node.snapshot)).toEqual([]);
  });

  it("duplicate ticker deploy in same block: only one wins", async () => {
    const e1 = deployEnvelope("DUPE", CREATOR, 10_000n);
    const e2 = deployEnvelope("DUPE", ATTACKER, 10_000n);
    await adapter.broadcast(sign(e1, CREATOR));
    await adapter.broadcast(sign(e2, ATTACKER));
    await node.mineBlock();
    const t1 = node.snapshot.txs[e1.txid]!;
    const t2 = node.snapshot.txs[e2.txid]!;
    const statuses = [t1.status, t2.status].sort();
    expect(statuses).toEqual(["CONFIRMED", "REJECTED"]);
    expect(node.snapshot.tickerIndex["DUPE"]).toBeDefined();
    expect(assertProtocolInvariants(node.snapshot)).toEqual([]);
  });

  it("zero asking price listing rejected", async () => {
    const env = buildEnvelope({
      op: "DEX_ASK",
      network: "mock",
      payload: { deploymentId: gradId, sellerAddress: SELLER, tokenAmountAtoms: 1_000_000n, askingPriceSats: 0n, expiryHeight: (await node.getHeight()) + 100n },
      inputs: [{ txid: "mock-utxo", vout: 0, address: SELLER, amountSats: 1_000_000_000n }],
      outputs: [],
      feeSats: 300n,
      stateHash: "",
      expiresAtHeight: 1000n,
      expiresAtTimestamp: new Date(Date.now() + 120_000).toISOString(),
    });
    const r = await submit(env, SELLER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("ZERO_PRICE");
  });

  it("non-owner cancel rejected", async () => {
    // Create a fresh listing, then try to cancel as attacker.
    const lb = await adapter.buildSellListing({ deploymentId: gradId, sellerAddress: SELLER, tokenAmountAtoms: 500_000n, askingPriceSats: 50_000n, expiryHeight: (await node.getHeight()) + 144n });
    await adapter.broadcast(`${lb.psbtBase64}\nMOCK-SIGNED-BY:${SELLER}`);
    await node.mineBlock();
    const lid = (await adapter.getListings()).find((l) => l.tokenAmountAtoms === 500_000n && l.status === "OPEN")!.id;
    const env = buildEnvelope({
      op: "DEX_CANCEL",
      network: "mock",
      payload: { listingId: lid, sellerAddress: SELLER },
      inputs: [{ txid: "mock-utxo", vout: 0, address: ATTACKER, amountSats: 1_000_000_000n }],
      outputs: [],
      feeSats: 300n,
      stateHash: "",
      expiresAtHeight: 1000n,
      expiresAtTimestamp: new Date(Date.now() + 120_000).toISOString(),
    });
    const r = await submit(env, ATTACKER);
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("NOT_LISTING_OWNER");
  });
});
