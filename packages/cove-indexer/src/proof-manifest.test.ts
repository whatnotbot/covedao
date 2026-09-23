import { describe, expect, it } from "vitest";
import { COVE_V1_SIGNET_CONFIG, createCoveState, applyCoveOperation } from "@crclaunch/protocol";
import { decideNextAction, validateTicker, type ProofManifest } from "./proof-manifest.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const ACTOR = "0014" + "aa".repeat(20);
const RECIPIENT = "0014" + "bb".repeat(20);
const MINT = 2_000_000n * 100_000_000n;
const TRANSFER = 500_000n * 100_000_000n;
const DEPLOY_TXID = "d".repeat(64);

function baseManifest(overrides: Partial<ProofManifest> = {}): ProofManifest {
  return {
    protocol: "cove",
    network: "signet",
    ticker: "FROG",
    signerA: ACTOR,
    signerB: RECIPIENT,
    ...overrides,
  };
}

function deployToState(state = createCoveState(), ticker = "FROG", txid = DEPLOY_TXID) {
  applyCoveOperation(state, {
    operation: "DEPLOY", txid, txIndex: 0, actor: ACTOR, ticker,
    protocolOutputs: [{ index: 1, scriptPubKeyHex: CFG.treasuryScript, amountSats: 10_000n, role: "launch-fee" }],
  }, CFG);
  return state;
}

function mintToState(state = createCoveState()) {
  deployToState(state);
  applyCoveOperation(state, {
    operation: "MINT", txid: "e".repeat(64), txIndex: 0, actor: ACTOR, recipient: ACTOR, ticker: "FROG",
    amountAtoms: MINT, supplyBeforeAtoms: 0n,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: ACTOR, amountSats: 330n, role: "recipient" },
      { index: 2, scriptPubKeyHex: CFG.settlementScript, amountSats: 1010n, role: "settlement" },
    ],
  }, CFG);
  return state;
}

describe("validateTicker", () => {
  it("accepts 4-char [A-Z0-9] and uppercases", () => {
    expect(validateTicker("frog")).toBe("FROG");
    expect(validateTicker("A1B2")).toBe("A1B2");
  });
  it("rejects invalid tickers", () => {
    expect(() => validateTicker("FROGS")).toThrow();
    expect(() => validateTicker("FRO!")).toThrow();
    expect(() => validateTicker("")).toThrow();
  });
});

describe("decideNextAction (resume/idempotency)", () => {
  it("empty state → DEPLOY", () => {
    const d = decideNextAction(baseManifest(), createCoveState(), ACTOR, RECIPIENT, MINT, TRANSFER);
    expect(d.action).toBe("DEPLOY");
  });

  it("deployed only → MINT", () => {
    const state = deployToState();
    const d = decideNextAction(baseManifest({ deploy: { txid: DEPLOY_TXID, height: 100, blockHash: "h", stateRoot: "r" } }), state, ACTOR, RECIPIENT, MINT, TRANSFER);
    expect(d.action).toBe("MINT");
  });

  it("minted (A=2M) → TRANSFER", () => {
    const state = mintToState();
    const d = decideNextAction(baseManifest({ deploy: { txid: DEPLOY_TXID, height: 1, blockHash: "", stateRoot: "" }, mint: { txid: "e".repeat(64), height: 2, blockHash: "", stateRoot: "" } }), state, ACTOR, RECIPIENT, MINT, TRANSFER);
    expect(d.action).toBe("TRANSFER");
  });

  it("all three done (A=1.5M, B=0.5M) → DONE", () => {
    const state = mintToState();
    applyCoveOperation(state, {
      operation: "TRANSFER", txid: "f".repeat(64), txIndex: 0, actor: ACTOR, recipient: RECIPIENT, ticker: "FROG",
      amountAtoms: TRANSFER,
      protocolOutputs: [
        { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 294n, role: "recipient" },
        { index: 2, scriptPubKeyHex: ACTOR, amountSats: 294n, role: "continuation" },
      ],
    }, CFG);
    const d = decideNextAction(baseManifest({
      deploy: { txid: DEPLOY_TXID, height: 1, blockHash: "", stateRoot: "" },
      mint: { txid: "e".repeat(64), height: 2, blockHash: "", stateRoot: "" },
      transfer: { txid: "f".repeat(64), height: 3, blockHash: "", stateRoot: "" },
    }), state, ACTOR, RECIPIENT, MINT, TRANSFER);
    expect(d.action).toBe("DONE");
  });

  it("unrelated deployment owns the ticker → throws", () => {
    const state = deployToState(createCoveState(), "FROG", "9".repeat(64));
    expect(() => decideNextAction(baseManifest({ deploy: { txid: DEPLOY_TXID, height: 1, blockHash: "", stateRoot: "" } }), state, ACTOR, RECIPIENT, MINT, TRANSFER)).toThrow(/unrelated deployment/);
  });

  it("deploy recorded but not confirmed → DEPLOY with reason (no blind redeploy)", () => {
    const d = decideNextAction(baseManifest({ deploy: { txid: DEPLOY_TXID, height: 0, blockHash: "", stateRoot: "" } }), createCoveState(), ACTOR, RECIPIENT, MINT, TRANSFER);
    expect(d.action).toBe("DEPLOY");
    expect(d.reason).toMatch(/not yet confirmed/);
  });
});
