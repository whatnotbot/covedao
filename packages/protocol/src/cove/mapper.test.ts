import { describe, expect, it } from "vitest";
import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { toCoveTransaction } from "./mapper.js";
import { decodeCoveEnvelope, encodeCoveDeploy, encodeCoveMint, encodeCoveTransfer } from "./envelope.js";

const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);
const SETTLEMENT = "0014" + "cc".repeat(20);
const TREASURY = "0014" + "dd".repeat(20);

function btcTx(overrides: Partial<BitcoinProtocolTx> = {}): BitcoinProtocolTx {
  return {
    txid: "a".repeat(64),
    version: 2,
    locktime: 0,
    inputs: [{ prevTxid: "b".repeat(64), vout: 0, sequence: 0xfffffffd, prevScriptPubKeyHex: ACTOR }],
    outputs: [],
    ...overrides,
  };
}

describe("toCoveTransaction", () => {
  it("maps DEPLOY (actor from input0, launch-fee from vout1)", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a0a", valueSats: 0n, opReturnData: encodeCoveDeploy("FROG") },
        { index: 1, scriptPubKeyHex: TREASURY, valueSats: 10_000n },
      ],
    });
    const env = decodeCoveEnvelope(encodeCoveDeploy("FROG")).envelope!;
    const r = toCoveTransaction(tx, env, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tx.operation).toBe("DEPLOY");
    expect(r.tx.actor).toBe(ACTOR);
    expect(r.tx.ticker).toBe("FROG");
    expect(r.tx.txIndex).toBe(3);
    expect(r.tx.protocolOutputs[0]).toMatchObject({ index: 1, scriptPubKeyHex: TREASURY, role: "launch-fee" });
  });

  it("maps MINT (recipient vout1, settlement vout2)", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a1a", valueSats: 0n, opReturnData: encodeCoveMint("FROG", 200_000_000_000_000n, 0n) },
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
        { index: 2, scriptPubKeyHex: SETTLEMENT, valueSats: 1010n },
      ],
    });
    const env = decodeCoveEnvelope(encodeCoveMint("FROG", 200_000_000_000_000n, 0n)).envelope!;
    const r = toCoveTransaction(tx, env, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tx.operation).toBe("MINT");
    expect(r.tx.recipient).toBe(RECIPIENT);
    expect(r.tx.amountAtoms).toBe(200_000_000_000_000n);
    expect(r.tx.supplyBeforeAtoms).toBe(0n);
    expect(r.tx.protocolOutputs.map((o) => o.role)).toEqual(["recipient", "settlement"]);
  });

  it("maps TRANSFER (recipient vout1, continuation vout2)", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a12", valueSats: 0n, opReturnData: encodeCoveTransfer("FROG", 50_000_000_000_000n) },
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 330n },
        { index: 2, scriptPubKeyHex: ACTOR, valueSats: 294n },
      ],
    });
    const env = decodeCoveEnvelope(encodeCoveTransfer("FROG", 50_000_000_000_000n)).envelope!;
    const r = toCoveTransaction(tx, env, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tx.operation).toBe("TRANSFER");
    expect(r.tx.recipient).toBe(RECIPIENT);
    expect(r.tx.continuation).toBe(ACTOR);
    expect(r.tx.protocolOutputs.map((o) => o.role)).toEqual(["recipient", "continuation"]);
  });

  it("rejects missing input0 prevout", () => {
    const tx = btcTx({ inputs: [{ prevTxid: "b".repeat(64), vout: 0, sequence: 0 }] });
    const env = decodeCoveEnvelope(encodeCoveDeploy("FROG")).envelope!;
    expect(toCoveTransaction(tx, env, 0)).toEqual({ ok: false, reason: "MISSING_INPUT0_PREVOUT" });
  });
});
