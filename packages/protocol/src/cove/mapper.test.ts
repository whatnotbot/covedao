import { describe, expect, it } from "vitest";
import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { toCoveTransaction } from "./mapper.js";
import type { CoveEnvelope } from "./parser.js";

const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);
const TREASURY = "5120" + "11".repeat(32);
const RESERVE = "0014" + "22".repeat(20);

function btcTx(overrides: Partial<BitcoinProtocolTx> = {}): BitcoinProtocolTx {
  return {
    txid: "a".repeat(64),
    version: 2,
    locktime: 0,
    inputs: [
      { prevTxid: "b".repeat(64), vout: 0, sequence: 0xfffffffd, prevScriptPubKeyHex: ACTOR },
    ],
    outputs: [],
    ...overrides,
  };
}

describe("toCoveTransaction", () => {
  it("maps a deploy envelope (actor from input0, fee from vout1)", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a", valueSats: 0n, opReturnData: new Uint8Array() },
        { index: 1, scriptPubKeyHex: TREASURY, valueSats: 10_000n },
      ],
    });
    const env: CoveEnvelope = { p: "cove", v: 1, protocol: "cove", op: "deploy", tick: "FROG" };
    const mapped = toCoveTransaction(tx, env);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.tx.operation).toBe("DEPLOY");
    expect(mapped.tx.actor).toBe(ACTOR);
    expect(mapped.tx.ticker).toBe("FROG");
    expect(mapped.tx.protocolOutputs).toEqual([
      { index: 1, scriptPubKeyHex: TREASURY, amountSats: 10_000n, role: "launch-fee" },
    ]);
  });

  it("maps a mint envelope with recipient/curve/fee roles", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a", valueSats: 0n, opReturnData: new Uint8Array() },
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 546n },
        { index: 2, scriptPubKeyHex: RESERVE, valueSats: 500n },
        { index: 3, scriptPubKeyHex: TREASURY, valueSats: 5n },
      ],
    });
    const env: CoveEnvelope = {
      p: "cove",
      v: 1,
      protocol: "cove",
      op: "mint",
      tick: "FROG",
      amt: 1_000_000n,
      s: 0n,
    };
    const mapped = toCoveTransaction(tx, env);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.tx.operation).toBe("MINT");
    expect(mapped.tx.recipient).toBe(RECIPIENT);
    expect(mapped.tx.ticker).toBe("FROG");
    expect(mapped.tx.tokenAmount).toBe(1_000_000n);
    expect(mapped.tx.supplyBefore).toBe(0n);
    expect(mapped.tx.protocolOutputs.map((o) => o.role)).toEqual([
      "recipient",
      "curve",
      "platform-fee",
    ]);
  });

  it("maps a transfer envelope", () => {
    const tx = btcTx({
      outputs: [
        { index: 0, scriptPubKeyHex: "6a", valueSats: 0n, opReturnData: new Uint8Array() },
        { index: 1, scriptPubKeyHex: RECIPIENT, valueSats: 546n },
      ],
    });
    const env: CoveEnvelope = {
      p: "cove",
      v: 1,
      protocol: "cove",
      op: "transfer",
      tick: "FROG",
      amt: 100_000n,
    };
    const mapped = toCoveTransaction(tx, env);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.tx.operation).toBe("TRANSFER");
    expect(mapped.tx.recipient).toBe(RECIPIENT);
    expect(mapped.tx.tokenAmount).toBe(100_000n);
  });

  it("rejects when input0 prevout is unresolved", () => {
    const tx = btcTx({ inputs: [{ prevTxid: "b".repeat(64), vout: 0, sequence: 0 }] });
    const env: CoveEnvelope = { p: "cove", v: 1, protocol: "cove", op: "deploy", tick: "FROG" };
    expect(toCoveTransaction(tx, env)).toEqual({ ok: false, reason: "MISSING_INPUT0_PREVOUT" });
  });
});
