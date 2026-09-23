import { describe, expect, it } from "vitest";
import { applyCoveOperation } from "./validator.js";
import { computeStateRoot } from "./state-root.js";
import { createCoveState, type CoveTransaction } from "./types.js";

const TREASURY = "5120" + "11".repeat(32);
const RESERVE = "0014" + "22".repeat(20);
const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "5120" + "bb".repeat(32);

const CFG = {
  treasuryScript: TREASURY,
  reserveScript: RESERVE,
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  supportedScriptPrefixes: ["0014", "5120"] as const,
};

function deploy(): CoveTransaction {
  return {
    protocol: "cove",
    version: 1,
    operation: "DEPLOY",
    txid: "d".repeat(64),
    actor: ACTOR,
    ticker: "FROG",
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: TREASURY, amountSats: 10_000n, role: "launch-fee" },
    ],
  };
}

function mint(supplyBefore: bigint): CoveTransaction {
  return {
    protocol: "cove",
    version: 1,
    operation: "MINT",
    txid: "e".repeat(64),
    actor: ACTOR,
    recipient: RECIPIENT,
    ticker: "FROG",
    tokenAmount: 1_000_000n,
    supplyBefore,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 546n, role: "recipient" },
      { index: 2, scriptPubKeyHex: RESERVE, amountSats: 500n, role: "curve" },
      { index: 3, scriptPubKeyHex: TREASURY, amountSats: 5n, role: "platform-fee" },
    ],
  };
}

describe("computeStateRoot", () => {
  it("is identical for the same applied sequence", () => {
    const a = createCoveState();
    applyCoveOperation(a, deploy(), CFG);
    applyCoveOperation(a, mint(0n), CFG);

    const b = createCoveState();
    applyCoveOperation(b, deploy(), CFG);
    applyCoveOperation(b, mint(0n), CFG);

    expect(computeStateRoot(a)).toBe(computeStateRoot(b));
  });

  it("changes when balances change", () => {
    const a = createCoveState();
    applyCoveOperation(a, deploy(), CFG);
    applyCoveOperation(a, mint(0n), CFG);
    const before = computeStateRoot(a);

    applyCoveOperation(a, mint(1_000_000n), CFG);
    expect(computeStateRoot(a)).not.toBe(before);
  });

  it("is a 64-hex sha256 digest", () => {
    const a = createCoveState();
    applyCoveOperation(a, deploy(), CFG);
    applyCoveOperation(a, mint(0n), CFG);
    expect(computeStateRoot(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
