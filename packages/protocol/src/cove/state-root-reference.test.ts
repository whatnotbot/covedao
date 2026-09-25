import { describe, expect, it } from "vitest";
import { applyCoveOperation } from "./validator.js";
import { computeStateRoot } from "./state-root.js";
import { referenceComputeStateRoot } from "./state-root-reference.js";
import { COVE_V1_SIGNET_CONFIG, configDomain } from "./config.js";
import { createCoveState, type CoveBalance, type CoveTransaction } from "./types.js";
import goldenVectors from "./state-root-vectors.json";

const CFG = COVE_V1_SIGNET_CONFIG;
const DOMAIN = configDomain(CFG);
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
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: CFG.treasuryScript, amountSats: 10_000n, role: "launch-fee" },
    ],
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
    amountAtoms: 100_000_000_000n,
    supplyBeforeAtoms: supplyBefore,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "recipient" },
      { index: 2, scriptPubKeyHex: CFG.settlementScript, amountSats: 8_779n, role: "settlement" },
    ],
  };
}

function transfer(): CoveTransaction {
  return {
    operation: "TRANSFER",
    txid: "f".repeat(64),
    txIndex: 0,
    actor: RECIPIENT,
    recipient: RECIPIENT2,
    ticker: "FROG",
    amountAtoms: 50_000_000_000n,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 294n, role: "recipient" },
      { index: 2, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "continuation" },
    ],
  };
}

function buildScenario(id: string): ReturnType<typeof createCoveState> {
  const s = createCoveState();
  if (id === "empty") return s;
  applyCoveOperation(s, deploy(), CFG);
  if (id === "deploy") return s;
  applyCoveOperation(s, mint(0n), CFG);
  if (id === "mint") return s;
  applyCoveOperation(s, transfer(), CFG);
  return s;
}

describe("state-root reference implementation", () => {
  it("domain matches the frozen golden-vector domain", () => {
    expect(DOMAIN).toBe(goldenVectors.domain);
  });

  for (const vector of goldenVectors.vectors) {
    it(`matches the frozen golden root for scenario "${vector.id}"`, () => {
      const state = buildScenario(vector.id);
      const prod = computeStateRoot(state, DOMAIN);
      const ref = referenceComputeStateRoot(state, DOMAIN);
      expect(prod).toBe(vector.root);
      expect(ref).toBe(vector.root);
      expect(prod).toBe(ref);
    });
  }

  it("reference implementation is order-independent (insertion order shuffled)", () => {
    const s = createCoveState();
    applyCoveOperation(s, deploy(), CFG);
    applyCoveOperation(s, mint(0n), CFG);
    // Rebuild an equivalent state with a different Map insertion order.
    const shuffled = createCoveState();
    shuffled.reserveSats = s.reserveSats;
    shuffled.platformTreasurySats = s.platformTreasurySats;
    for (const [k, v] of [...s.tokens.entries()].reverse()) shuffled.tokens.set(k, v);
    for (const [k, v] of [...s.tickerIndex.entries()].reverse()) shuffled.tickerIndex.set(k, v);
    for (const [owner, byDep] of [...s.balances.entries()].reverse()) {
      const m = new Map<string, CoveBalance>();
      for (const [dep, b] of [...byDep.entries()].reverse()) m.set(dep, b);
      shuffled.balances.set(owner, m);
    }
    expect(computeStateRoot(shuffled, DOMAIN)).toBe(computeStateRoot(s, DOMAIN));
    expect(referenceComputeStateRoot(shuffled, DOMAIN)).toBe(computeStateRoot(s, DOMAIN));
  });
});
