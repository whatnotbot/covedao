import { describe, expect, it } from "vitest";
import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { CoveIndexer } from "./indexer.js";
import { COVE_SIGNET_CONFIG } from "./config.js";
import { encodeCoveDeploy, encodeCoveMint, encodeCoveTransfer } from "@crclaunch/protocol";

const CFG = COVE_SIGNET_CONFIG;
const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);

function opReturnOut(payload: Uint8Array, index = 0) {
  const len = payload.length.toString(16).padStart(2, "0");
  return {
    index,
    scriptPubKeyHex: `6a${len}${Buffer.from(payload).toString("hex")}`,
    valueSats: 0n,
    opReturnData: payload,
  };
}

function tx(opReturn: Uint8Array, extraOuts: { index: number; scriptPubKeyHex: string; valueSats: bigint }[], txid = "a".repeat(64)): BitcoinProtocolTx {
  return {
    txid,
    version: 2,
    locktime: 0,
    inputs: [{ prevTxid: "b".repeat(64), vout: 0, sequence: 0xfffffffd, prevScriptPubKeyHex: ACTOR }],
    outputs: [opReturnOut(opReturn, 0), ...extraOuts],
  };
}

describe("CoveIndexer (binary envelope, classification, tx index)", () => {
  it("indexes deploy → mint → transfer with txIndex ordering", () => {
    const idx = new CoveIndexer(CFG);
    idx.processBlock(CFG.genesisHeight, [
      tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], "d".repeat(64)),
    ]);
    idx.processBlock(CFG.genesisHeight + 1, [
      tx(encodeCoveMint("FROG", 200_000_000_000_000n, 0n), [
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
        { index: 2, scriptPubKeyHex: CFG.settlementScript, valueSats: 1010n },
      ], "e".repeat(64)),
    ]);
    const stats = idx.getStats();
    expect(stats.validOps).toBe(2);
    expect(stats.tokens).toBe(1);
    expect(stats.reserveSats).toBe(1000n);
    expect(stats.treasurySats).toBe(10_010n);
    expect(stats.stateRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies non-Cove OP_RETURN as NON_COVE (not invalid)", () => {
    const idx = new CoveIndexer(CFG);
    const plain = tx(new TextEncoder().encode("coinbin.org"), [
      { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 546n },
    ]);
    const r = idx.processTx(CFG.genesisHeight, 0, plain);
    expect(r.classification).toBe("NON_COVE");
    expect(idx.getStats().coveCandidateTxs).toBe(0);
    expect(idx.getStats().invalidOps).toBe(0);
  });

  it("classifies Cove-magic-but-malformed as MALFORMED_COVE", () => {
    const idx = new CoveIndexer(CFG);
    const bad = new Uint8Array([0x43, 0x4f, 0x56, 0x45, 0x02, 0x02, 0x46]); // COVE + wrong version + garbage
    const r = idx.processTx(CFG.genesisHeight, 0, tx(bad, []));
    expect(r.classification).toBe("MALFORMED_COVE");
    expect(idx.getStats().invalidOps).toBe(1);
  });

  it("rejects multiple Cove envelopes in one tx", () => {
    const idx = new CoveIndexer(CFG);
    const two = {
      txid: "a".repeat(64),
      version: 2,
      locktime: 0,
      inputs: [{ prevTxid: "b".repeat(64), vout: 0, sequence: 0, prevScriptPubKeyHex: ACTOR }],
      outputs: [
        opReturnOut(encodeCoveDeploy("FROG"), 0),
        opReturnOut(encodeCoveDeploy("TOAD"), 1),
        { index: 2, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n },
      ],
    } as BitcoinProtocolTx;
    const r = idx.processTx(CFG.genesisHeight, 0, two);
    expect(r.classification).toBe("MULTIPLE_COVE_OPERATIONS");
    expect(idx.getStats().tokens).toBe(0);
  });

  it("earlier txIndex wins for duplicate ticker; later is stale", () => {
    const idx = new CoveIndexer(CFG);
    const deploy = (txid: string) =>
      tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], txid);
    // Two DEPLOY FROG in the same block; index 0 valid, index 1 rejected.
    const block = [deploy("d".repeat(64)), deploy("e".repeat(64))];
    idx.processBlock(CFG.genesisHeight, block);
    const events = idx.getEvents();
    expect(events[0]!.txIndex).toBe(0);
    expect(events[0]!.valid).toBe(true);
    expect(events[1]!.txIndex).toBe(1);
    expect(events[1]!.reason).toBe("TICKER_TAKEN");
    expect(idx.getStats().validOps).toBe(1);
    expect(idx.getStats().invalidOps).toBe(1);
  });

  it("reorg rebuild is deterministic", () => {
    const build = (mintAmount: bigint) => {
      const idx = new CoveIndexer(CFG);
      idx.processBlock(CFG.genesisHeight, [
        tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], "d".repeat(64)),
      ]);
      idx.processBlock(CFG.genesisHeight + 1, [
        tx(encodeCoveMint("FROG", mintAmount, 0n), [
          { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
          { index: 2, scriptPubKeyHex: CFG.settlementScript, valueSats: 1010n },
        ], "e".repeat(64)),
      ]);
      return idx;
    };
    const a = build(200_000_000_000_000n);
    const fork = build(300_000_000_000_000n);
    expect(fork.getStateRoot()).not.toBe(a.getStateRoot());
    const restored = build(200_000_000_000_000n);
    expect(restored.getStateRoot()).toBe(a.getStateRoot());
  });

  it("transfer requires continuation (via full pipeline)", () => {
    const idx = new CoveIndexer(CFG);
    idx.processBlock(CFG.genesisHeight, [
      tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], "d".repeat(64)),
    ]);
    idx.processBlock(CFG.genesisHeight + 1, [
      tx(encodeCoveMint("FROG", 200_000_000_000_000n, 0n), [
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
        { index: 2, scriptPubKeyHex: CFG.settlementScript, valueSats: 1010n },
      ], "e".repeat(64)),
    ]);
    // Transfer WITHOUT continuation output (only recipient) → invalid.
    const noCont = tx(encodeCoveTransfer("FROG", 50_000_000_000_000n), [
      { index: 1, scriptPubKeyHex: "0014" + "cc".repeat(20), valueSats: 294n },
    ], "f".repeat(64));
    noCont.inputs[0]!.prevScriptPubKeyHex = RECIPIENT; // sender is RECIPIENT
    const r = idx.processTx(CFG.genesisHeight + 2, 0, noCont);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("MISSING_CONTINUATION");
  });

  it("rejects a replayed Cove txid (no double-apply)", () => {
    const idx = new CoveIndexer(CFG);
    const deploy = tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], "d".repeat(64));
    idx.processBlock(CFG.genesisHeight, [deploy]);
    const rootBefore = idx.getStateRoot();
    const treasuryBefore = idx.getState().platformTreasurySats;
    // Replay the same deploy block → REPLAY, no state change.
    const r = idx.processTx(CFG.genesisHeight, 0, deploy);
    expect(r.reason).toBe("REPLAY");
    expect(idx.getStateRoot()).toBe(rootBefore);
    expect(idx.getState().platformTreasurySats).toBe(treasuryBefore);
  });

  it("rejects a block below genesis and a non-contiguous height", () => {
    const idx = new CoveIndexer(CFG);
    expect(() => idx.processBlock(CFG.genesisHeight - 1, [])).toThrow(/below genesis/);
    idx.processBlock(CFG.genesisHeight, []);
    expect(() => idx.processBlock(CFG.genesisHeight + 2, [])).toThrow(/non-contiguous/);
  });

  it("records an invalid mint without mutating state", () => {
    const idx = new CoveIndexer(CFG);
    idx.processBlock(CFG.genesisHeight, [
      tx(encodeCoveDeploy("FROG"), [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, valueSats: 10_000n }], "d".repeat(64)),
    ]);
    // Overpay the settlement → invalid; reserve must stay 0.
    idx.processBlock(CFG.genesisHeight + 1, [
      tx(encodeCoveMint("FROG", 200_000_000_000_000n, 0n), [
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
        { index: 2, scriptPubKeyHex: CFG.settlementScript, valueSats: 9999n },
      ], "e".repeat(64)),
    ]);
    expect(idx.getStats().validOps).toBe(1);
    expect(idx.getStats().invalidOps).toBe(1);
    expect(idx.getState().reserveSats).toBe(0n); // rejected mint did not credit reserve
  });
});
