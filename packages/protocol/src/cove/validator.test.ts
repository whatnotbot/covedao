import { describe, expect, it } from "vitest";
import { applyCoveOperation, validateCoveOperation, type CoveConfig } from "./validator.js";
import { createCoveState, type CoveTransaction } from "./types.js";

const TREASURY = "5120" + "11".repeat(32); // P2TR-style canonical treasury
const RESERVE = "0014" + "22".repeat(20); // P2WPKH-style canonical reserve
const ACTOR = "0014" + "aa".repeat(20); // P2WPKH actor
const RECIPIENT = "5120" + "bb".repeat(32); // P2TR recipient
const RECIPIENT2 = "0014" + "cc".repeat(20); // P2WPKH recipient

const CFG: CoveConfig = {
  treasuryScript: TREASURY,
  reserveScript: RESERVE,
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  supportedScriptPrefixes: ["0014", "5120"],
};

const DEPLOY_TXID = "d".repeat(64);
const MINT_TXID = "e".repeat(64);
const TRANSFER_TXID = "f".repeat(64);

function deployTx(overrides: Partial<CoveTransaction> = {}): CoveTransaction {
  return {
    protocol: "cove",
    version: 1,
    operation: "DEPLOY",
    txid: DEPLOY_TXID,
    actor: ACTOR,
    ticker: "FROG",
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: TREASURY, amountSats: 10_000n, role: "launch-fee" },
    ],
    ...overrides,
  };
}

function mintTx(
  amount: bigint,
  supplyBefore: bigint,
  curveSats: bigint,
  feeSats: bigint,
  overrides: Partial<CoveTransaction> = {},
): CoveTransaction {
  return {
    protocol: "cove",
    version: 1,
    operation: "MINT",
    txid: MINT_TXID,
    actor: ACTOR,
    recipient: RECIPIENT,
    ticker: "FROG",
    tokenAmount: amount,
    supplyBefore,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 546n, role: "recipient" },
      { index: 2, scriptPubKeyHex: RESERVE, amountSats: curveSats, role: "curve" },
      { index: 3, scriptPubKeyHex: TREASURY, amountSats: feeSats, role: "platform-fee" },
    ],
    ...overrides,
  };
}

function transferTx(amount: bigint, overrides: Partial<CoveTransaction> = {}): CoveTransaction {
  return {
    protocol: "cove",
    version: 1,
    operation: "TRANSFER",
    txid: TRANSFER_TXID,
    actor: RECIPIENT, // RECIPIENT holds the minted tokens
    recipient: RECIPIENT2,
    ticker: "FROG",
    tokenAmount: amount,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 546n, role: "recipient" },
    ],
    ...overrides,
  };
}

describe("Cove DEPLOY validator", () => {
  it("accepts a canonical deploy and applies it", () => {
    const state = createCoveState();
    const tx = deployTx();
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(state, tx, CFG);
    const token = state.tokens.get(DEPLOY_TXID);
    expect(token).toBeDefined();
    expect(token!.ticker).toBe("FROG");
    expect(token!.confirmedSupply).toBe(0n);
    expect(state.tickerIndex.get("FROG")).toBe(DEPLOY_TXID);
    expect(state.platformTreasurySats).toBe(10_000n);
  });

  it("rejects a taken ticker", () => {
    const state = createCoveState();
    applyCoveOperation(state, deployTx(), CFG);
    const second = deployTx({ txid: "a".repeat(64) });
    expect(validateCoveOperation(state, second, CFG)).toEqual({
      valid: false,
      reason: "TICKER_TAKEN",
    });
  });

  it("rejects wrong launch fee", () => {
    const state = createCoveState();
    const tx = deployTx({
      protocolOutputs: [
        { index: 1, scriptPubKeyHex: TREASURY, amountSats: 9_999n, role: "launch-fee" },
      ],
    });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: false, reason: "UNDERPAYMENT" });
  });

  it("rejects wrong treasury", () => {
    const state = createCoveState();
    const tx = deployTx({
      protocolOutputs: [
        {
          index: 1,
          scriptPubKeyHex: "0014" + "99".repeat(20),
          amountSats: 10_000n,
          role: "launch-fee",
        },
      ],
    });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "WRONG_TREASURY",
    });
  });

  it("rejects unsupported actor script", () => {
    const state = createCoveState();
    const tx = deployTx({ actor: "76a914" + "11".repeat(20) + "88ac" }); // P2PKH
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "UNSUPPORTED_ACTOR_SCRIPT",
    });
  });
});

describe("Cove MINT validator", () => {
  function deployedState() {
    const state = createCoveState();
    applyCoveOperation(state, deployTx(), CFG);
    return state;
  }

  it("accepts a canonical 1M-token mint (stage 1: 500 sats + 5 sats fee)", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 0n, 500n, 5n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(state, tx, CFG);
    const token = state.tokens.get(DEPLOY_TXID)!;
    expect(token.confirmedSupply).toBe(1_000_000n);
    expect(token.currentStage).toBe(1);
    expect(state.reserveSats).toBe(500n);
    expect(state.platformTreasurySats).toBe(10_005n);
    expect(state.balances.get(RECIPIENT)!.get(DEPLOY_TXID)!.available).toBe(1_000_000n);
  });

  it("advances stage after filling stage 1", () => {
    const state = deployedState();
    // Fill stage 1 exactly (42M tokens) at 21,000 sats + 210 sats fee.
    applyCoveOperation(state, mintTx(42_000_000n, 0n, 21_000n, 210n), CFG);
    const token = state.tokens.get(DEPLOY_TXID)!;
    expect(token.currentStage).toBe(2);
    // Next 1M tokens cost 675 sats (stage 2) + 7 sats fee.
    const tx = mintTx(1_000_000n, 42_000_000n, 675n, 7n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: true, reason: null });
  });

  it("rejects stale supply", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 1n, 500n, 5n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: false, reason: "STALE_SUPPLY" });
  });

  it("rejects unknown deployment (unknown ticker)", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 0n, 500n, 5n, { ticker: "TOAD" });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "UNKNOWN_DEPLOYMENT",
    });
  });

  it("rejects wrong curve payment", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 0n, 499n, 5n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: false, reason: "UNDERPAYMENT" });
  });

  it("rejects wrong platform fee", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 0n, 500n, 4n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: false, reason: "UNDERPAYMENT" });
  });

  it("rejects wrong reserve script", () => {
    const state = deployedState();
    const tx = mintTx(1_000_000n, 0n, 500n, 5n, {
      protocolOutputs: [
        { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 546n, role: "recipient" },
        { index: 2, scriptPubKeyHex: "0014" + "00".repeat(20), amountSats: 500n, role: "curve" },
        { index: 3, scriptPubKeyHex: TREASURY, amountSats: 5n, role: "platform-fee" },
      ],
    });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "WRONG_RESERVE",
    });
  });

  it("rejects overmint beyond public supply", () => {
    const state = deployedState();
    const tx = mintTx(840_000_001n, 0n, 0n, 0n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: false, reason: "OVERMINT" });
  });
});

describe("Cove TRANSFER validator", () => {
  function mintedState() {
    const state = createCoveState();
    applyCoveOperation(state, deployTx(), CFG);
    applyCoveOperation(state, mintTx(1_000_000n, 0n, 500n, 5n), CFG);
    return state;
  }

  it("accepts a transfer and moves balance", () => {
    const state = mintedState();
    const tx = transferTx(100_000n);
    expect(validateCoveOperation(state, tx, CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(state, tx, CFG);
    expect(state.balances.get(RECIPIENT)!.get(DEPLOY_TXID)!.available).toBe(1_000_000n - 100_000n);
    expect(state.balances.get(RECIPIENT2)!.get(DEPLOY_TXID)!.available).toBe(100_000n);
  });

  it("rejects insufficient balance", () => {
    const state = mintedState();
    const tx = transferTx(2_000_000n); // more than the 1M held
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "INSUFFICIENT_AVAILABLE_TOKENS",
    });
  });

  it("rejects self-transfer", () => {
    const state = mintedState();
    const tx = transferTx(100_000n, { recipient: RECIPIENT });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "SELF_TRANSFER",
    });
  });

  it("rejects unknown deployment", () => {
    const state = mintedState();
    const tx = transferTx(100_000n, { ticker: "TOAD" });
    expect(validateCoveOperation(state, tx, CFG)).toEqual({
      valid: false,
      reason: "UNKNOWN_DEPLOYMENT",
    });
  });
});
