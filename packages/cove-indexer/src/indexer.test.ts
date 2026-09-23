import { describe, expect, it } from "vitest";
import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { CoveIndexer } from "./indexer.js";
import { COVE_SIGNET_CONFIG } from "./config.js";

const TREASURY = COVE_SIGNET_CONFIG.treasuryScript;
const RESERVE = COVE_SIGNET_CONFIG.reserveScript;
const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const opReturnOut = (json: string) => ({
  index: 0,
  scriptPubKeyHex: "6a" + Buffer.from(json, "utf8").toString("hex"),
  valueSats: 0n,
  opReturnData: enc(json),
});

function deployTx(txid = "d".repeat(64)): BitcoinProtocolTx {
  return {
    txid,
    version: 2,
    locktime: 0,
    inputs: [
      { prevTxid: "a".repeat(64), vout: 0, sequence: 0xfffffffd, prevScriptPubKeyHex: ACTOR },
    ],
    outputs: [
      opReturnOut('{"p":"cove","v":1,"op":"deploy","tick":"FROG"}'),
      { index: 1, scriptPubKeyHex: TREASURY, valueSats: 10_000n },
    ],
  };
}

function mintTx(
  amount: bigint,
  supplyBefore: bigint,
  curve: bigint,
  fee: bigint,
  txid = "e".repeat(64),
): BitcoinProtocolTx {
  return {
    txid,
    version: 2,
    locktime: 0,
    inputs: [
      { prevTxid: "a".repeat(64), vout: 1, sequence: 0xfffffffd, prevScriptPubKeyHex: ACTOR },
    ],
    outputs: [
      opReturnOut(
        `{"p":"cove","v":1,"op":"mint","tick":"FROG","amt":"${amount}","s":"${supplyBefore}"}`,
      ),
      { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 546n },
      { index: 2, scriptPubKeyHex: RESERVE, valueSats: curve },
      { index: 3, scriptPubKeyHex: TREASURY, valueSats: fee },
    ],
  };
}

function transferTx(amount: bigint, txid = "f".repeat(64)): BitcoinProtocolTx {
  return {
    txid,
    version: 2,
    locktime: 0,
    inputs: [
      { prevTxid: "a".repeat(64), vout: 2, sequence: 0xfffffffd, prevScriptPubKeyHex: RECIPIENT },
    ],
    outputs: [
      opReturnOut(`{"p":"cove","v":1,"op":"transfer","tick":"FROG","amt":"${amount}"}`),
      { index: 1, scriptPubKeyHex: "0014" + "cc".repeat(20), valueSats: 546n },
    ],
  };
}

describe("CoveIndexer", () => {
  it("indexes a full deploy → mint → transfer sequence deterministically", () => {
    const idx = new CoveIndexer(COVE_SIGNET_CONFIG);
    idx.processBlock(100, [deployTx()]);
    idx.processBlock(101, [mintTx(1_000_000n, 0n, 500n, 5n)]);
    idx.processBlock(102, [transferTx(100_000n)]);

    const stats = idx.getStats();
    expect(stats.processedBlocks).toBe(3);
    expect(stats.coveTxs).toBe(3);
    expect(stats.validOps).toBe(3);
    expect(stats.invalidOps).toBe(0);
    expect(stats.tokens).toBe(1);
    expect(stats.reserveSats).toBe(500n);
    expect(stats.treasurySats).toBe(10_005n);
    expect(stats.stateRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores non-Cove transactions", () => {
    const idx = new CoveIndexer(COVE_SIGNET_CONFIG);
    const plain: BitcoinProtocolTx = {
      txid: "9".repeat(64),
      version: 2,
      locktime: 0,
      inputs: [{ prevTxid: "a".repeat(64), vout: 0, sequence: 0, prevScriptPubKeyHex: ACTOR }],
      outputs: [{ index: 0, scriptPubKeyHex: "0014" + "ab".repeat(20), valueSats: 1_000n }],
    };
    idx.processBlock(1, [plain]);
    expect(idx.getStats().coveTxs).toBe(0);
    expect(idx.getStats().processedTxs).toBe(1);
  });

  it("records invalid Cove operations without mutating state", () => {
    const idx = new CoveIndexer(COVE_SIGNET_CONFIG);
    idx.processBlock(1, [deployTx()]);
    // Overpay the curve → invalid, no state change.
    idx.processBlock(2, [mintTx(1_000_000n, 0n, 999n, 5n)]);
    const stats = idx.getStats();
    expect(stats.validOps).toBe(1);
    expect(stats.invalidOps).toBe(1);
    expect(stats.tokens).toBe(1);
    expect(stats.reserveSats).toBe(0n); // mint rejected
  });

  it("is replay-deterministic (two independent runs yield the same root)", () => {
    const a = new CoveIndexer(COVE_SIGNET_CONFIG);
    const b = new CoveIndexer(COVE_SIGNET_CONFIG);
    for (const idx of [a, b]) {
      idx.processBlock(1, [deployTx()]);
      idx.processBlock(2, [mintTx(1_000_000n, 0n, 500n, 5n)]);
    }
    expect(a.getStateRoot()).toBe(b.getStateRoot());
  });

  it("rebuilds deterministically after a reorg (different fork → different root, restore → original)", () => {
    const original = new CoveIndexer(COVE_SIGNET_CONFIG);
    original.processBlock(1, [deployTx()]);
    original.processBlock(2, [mintTx(1_000_000n, 0n, 500n, 5n)]);
    const originalRoot = original.getStateRoot();

    // Alternative fork: block 2 is a different mint amount.
    const fork = new CoveIndexer(COVE_SIGNET_CONFIG);
    fork.processBlock(1, [deployTx()]);
    fork.processBlock(2, [mintTx(2_000_000n, 0n, 1_000n, 10n)]);
    expect(fork.getStateRoot()).not.toBe(originalRoot);

    // Rebuild the original chain from scratch → same root as before.
    const restored = new CoveIndexer(COVE_SIGNET_CONFIG);
    restored.processBlock(1, [deployTx()]);
    restored.processBlock(2, [mintTx(1_000_000n, 0n, 500n, 5n)]);
    expect(restored.getStateRoot()).toBe(originalRoot);
  });

  it("has a stable empty-state root", () => {
    const a = new CoveIndexer(COVE_SIGNET_CONFIG);
    const b = new CoveIndexer(COVE_SIGNET_CONFIG);
    expect(a.getStateRoot()).toBe(b.getStateRoot());
    expect(a.getStateRoot()).toMatch(/^[0-9a-f]{64}$/);
  });
});
