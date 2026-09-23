import { describe, expect, it } from "vitest";
import { applyCoveOperation } from "./validator.js";
import { computeStateRoot } from "./state-root.js";
import { COVE_V1_SIGNET_CONFIG } from "./config.js";
import { createCoveState, type CoveTransaction } from "./types.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);
const RECIPIENT2 = "0014" + "cc".repeat(20);

function deploy(): CoveTransaction {
  return {
    operation: "DEPLOY",
    txid: "d".repeat(64),
    txIndex: 0,
    actor: ACTOR,
    ticker: "FROG",
    protocolOutputs: [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, amountSats: 10_000n, role: "launch-fee" }],
  };
}

function mint(supplyBefore: bigint): CoveTransaction {
  return {
    operation: "MINT",
    txid: "e".repeat(64),
    txIndex: 0,
    actor: ACTOR,
    recipient: RECIPIENT,
    ticker: "FROG",
    amountAtoms: 200_000_000_000_000n,
    supplyBeforeAtoms: supplyBefore,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "recipient" },
      { index: 2, scriptPubKeyHex: CFG.settlementScript, amountSats: 1010n, role: "settlement" },
    ],
  };
}

describe("computeStateRoot", () => {
  it("is deterministic for the same sequence", () => {
    const a = createCoveState();
    applyCoveOperation(a, deploy(), CFG);
    applyCoveOperation(a, mint(0n), CFG);
    const b = createCoveState();
    applyCoveOperation(b, deploy(), CFG);
    applyCoveOperation(b, mint(0n), CFG);
    expect(computeStateRoot(a)).toBe(computeStateRoot(b));
  });

  it("changes when balances change (transfer)", () => {
    const a = createCoveState();
    applyCoveOperation(a, deploy(), CFG);
    applyCoveOperation(a, mint(0n), CFG);
    const before = computeStateRoot(a);
    applyCoveOperation(a, {
      operation: "TRANSFER",
      txid: "f".repeat(64),
      txIndex: 0,
      actor: RECIPIENT,
      recipient: RECIPIENT2,
      continuation: RECIPIENT,
      ticker: "FROG",
      amountAtoms: 50_000_000_000_000n,
      protocolOutputs: [
        { index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 294n, role: "recipient" },
        { index: 2, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "continuation" },
      ],
    }, CFG);
    expect(computeStateRoot(a)).not.toBe(before);
  });

  it("is a 64-hex sha256 digest", () => {
    const s = createCoveState();
    applyCoveOperation(s, deploy(), CFG);
    expect(computeStateRoot(s)).toMatch(/^[0-9a-f]{64}$/);
  });
});
