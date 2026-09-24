import { describe, expect, it } from "vitest";
import { encodeUndo, decodeUndo } from "./undo.js";
import type { BlockUndo, UndoOp, V3Backing, V3TokenUtxo } from "./types.js";

const backing: V3Backing = {
  tokenId: "ab".repeat(32),
  state: { stateVersion: 2, policyVersion: 3, tokenId: "ab".repeat(32), issuedPublicSupplyAtoms: 84_000_000n * 100_000_000n, backingSats: 49_350n, curveStage: 2 },
  stateHash: "c".repeat(64),
  outpoint: { txid: "d".repeat(64), vout: 1 },
  scriptPubKey: "5120" + "e".repeat(64),
  btcValue: 59_350n,
  updatedTxid: "d".repeat(64),
  updatedHeight: 2n,
  updatedBlockHash: "b2".padEnd(64, "0"),
};

function utxo(txid: string, vout: number): V3TokenUtxo {
  return {
    txid,
    vout,
    tokenId: "ab".repeat(32),
    amountAtoms: 42_000_000n * 100_000_000n,
    scriptPubKey: "0014" + "f".repeat(40),
    createdHeight: 2n,
    createdBlockHash: "b2".padEnd(64, "0"),
  };
}

const ops: UndoOp[] = [
  { kind: "DEPLOY", tokenId: "ab".repeat(32) },
  { kind: "MINT", tokenId: "ab".repeat(32), priorBacking: backing, createdUtxo: utxo("d".repeat(64), 2) },
  { kind: "TRANSFER", spendingTxid: "e".repeat(64), spentUtxos: [utxo("d".repeat(64), 2)], createdUtxos: [utxo("e".repeat(64), 1)] },
  { kind: "REDEEM", tokenId: "ab".repeat(32), spendingTxid: "e".repeat(64), priorBacking: backing, spentUtxos: [utxo("e".repeat(64), 1)], createdUtxos: [] },
];

describe("undo JSON roundtrip (§10)", () => {
  it("roundtrips every UndoOp kind exactly", () => {
    const undo: BlockUndo = { height: 3n, blockHash: "b3".padEnd(64, "0"), ops };
    const decoded = decodeUndo(encodeUndo(undo));
    expect(decoded).toEqual(undo);
    expect(decoded.ops.length).toBe(4);
    expect(decoded.ops[2]).toMatchObject({ kind: "TRANSFER", spendingTxid: "e".repeat(64) });
  });

  it("preserves bigints exactly", () => {
    const decoded = decodeUndo(encodeUndo({ height: 9_223_372_036_854_775_807n, blockHash: "b".padEnd(64, "0"), ops: [{ kind: "MINT", tokenId: "ab".repeat(32), priorBacking: backing, createdUtxo: utxo("d".repeat(64), 2) }] }));
    expect(decoded.height).toBe(9_223_372_036_854_775_807n);
    expect((decoded.ops[0] as { createdUtxo: V3TokenUtxo }).createdUtxo.amountAtoms).toBe(42_000_000n * 100_000_000n);
  });

  it("fails loudly on malformed undo JSON", () => {
    expect(() => decodeUndo("not json")).toThrow(/MALFORMED_UNDO/);
    expect(() => decodeUndo(JSON.stringify({ height: 1, blockHash: "x", ops: [{ kind: "BOGUS" }] }))).toThrow(/MALFORMED_UNDO/);
    expect(() => decodeUndo(JSON.stringify({ height: { __bigint: "1" }, blockHash: "b".padEnd(64, "0"), ops: [{ kind: "TRANSFER", spentUtxos: "nope" }] }))).toThrow(/MALFORMED_UNDO/);
  });

  it("full REDEEM with no created UTXO roundtrips (spending txid preserved)", () => {
    const op: UndoOp = { kind: "REDEEM", tokenId: "ab".repeat(32), spendingTxid: "f".repeat(64), priorBacking: backing, spentUtxos: [utxo("e".repeat(64), 1)], createdUtxos: [] };
    const decoded = decodeUndo(encodeUndo({ height: 4n, blockHash: "b4".padEnd(64, "0"), ops: [op] }));
    expect((decoded.ops[0] as { spendingTxid: string; createdUtxos: unknown[] }).spendingTxid).toBe("f".repeat(64));
    expect((decoded.ops[0] as { createdUtxos: unknown[] }).createdUtxos).toEqual([]);
  });
});
