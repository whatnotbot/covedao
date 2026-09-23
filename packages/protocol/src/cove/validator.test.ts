import { describe, expect, it } from "vitest";
import { applyCoveOperation, validateCoveOperation } from "./validator.js";
import { COVE_V1_SIGNET_CONFIG } from "./config.js";
import { createCoveState, type CoveTransaction } from "./types.js";

const CFG = COVE_V1_SIGNET_CONFIG;
const SETTLEMENT = CFG.settlementScript;
const TREASURY = CFG.treasuryScript;
const ACTOR = "0014" + "aa".repeat(20); // P2WPKH
const RECIPIENT = "5120" + "bb".repeat(32); // P2TR
const RECIPIENT2 = "0014" + "cc".repeat(20); // P2WPKH
const DEPLOY_TXID = "d".repeat(64);
const atoms = (tokens: number | bigint): bigint => BigInt(tokens) * 100_000_000n;

// 2,000,000 display tokens → 1,000 sats curve + 10 sats fee = 1,010 settlement.
const MINT_AMOUNT = atoms(2_000_000);

function deployTx(overrides: Partial<CoveTransaction> = {}): CoveTransaction {
  return {
    operation: "DEPLOY",
    txid: DEPLOY_TXID,
    txIndex: 0,
    actor: ACTOR,
    ticker: "FROG",
    protocolOutputs: [{ index: 1, scriptPubKeyHex: TREASURY, amountSats: 10_000n, role: "launch-fee" }],
    ...overrides,
  };
}

function mintTx(
  amount: bigint = MINT_AMOUNT,
  supplyBefore: bigint = 0n,
  settlementSats: bigint = 1010n,
  overrides: Partial<CoveTransaction> = {},
): CoveTransaction {
  return {
    operation: "MINT",
    txid: "e".repeat(64),
    txIndex: 0,
    actor: ACTOR,
    recipient: RECIPIENT,
    ticker: "FROG",
    amountAtoms: amount,
    supplyBeforeAtoms: supplyBefore,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "recipient" },
      { index: 2, scriptPubKeyHex: SETTLEMENT, amountSats: settlementSats, role: "settlement" },
    ],
    ...overrides,
  };
}

function transferTx(
  amount: bigint = atoms(500_000),
  overrides: Partial<CoveTransaction> = {},
): CoveTransaction {
  return {
    operation: "TRANSFER",
    txid: "f".repeat(64),
    txIndex: 0,
    actor: RECIPIENT, // holds the minted tokens
    recipient: RECIPIENT2,
    ticker: "FROG",
    amountAtoms: amount,
    protocolOutputs: [
      { index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 294n, role: "recipient" },
      { index: 2, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "continuation" },
    ],
    ...overrides,
  };
}

function deployedState() {
  const s = createCoveState();
  applyCoveOperation(s, deployTx(), CFG);
  return s;
}

describe("Cove DEPLOY", () => {
  it("accepts + applies canonical deploy", () => {
    const s = createCoveState();
    expect(validateCoveOperation(s, deployTx(), CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(s, deployTx(), CFG);
    expect(s.tickerIndex.get("FROG")).toBe(DEPLOY_TXID);
    expect(s.platformTreasurySats).toBe(10_000n);
  });

  it("rejects duplicate ticker", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, deployTx({ txid: "a".repeat(64) }), CFG)).toEqual({
      valid: false,
      reason: "TICKER_TAKEN",
    });
  });

  it("rejects wrong launch fee and wrong treasury", () => {
    const s = createCoveState();
    expect(
      validateCoveOperation(
        s,
        deployTx({ protocolOutputs: [{ index: 1, scriptPubKeyHex: TREASURY, amountSats: 9_999n, role: "launch-fee" }] }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "UNDERPAYMENT" });
    expect(
      validateCoveOperation(
        s,
        deployTx({ protocolOutputs: [{ index: 1, scriptPubKeyHex: ACTOR, amountSats: 10_000n, role: "launch-fee" }] }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "WRONG_TREASURY" });
  });
});

describe("Cove MINT (combined settlement + min contribution)", () => {
  it("accepts + applies a 2M-token mint (curve 1000 + fee 10 = 1010 settlement)", () => {
    const s = deployedState();
    const tx = mintTx();
    expect(validateCoveOperation(s, tx, CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(s, tx, CFG);
    const token = s.tokens.get(DEPLOY_TXID)!;
    expect(token.confirmedSupplyAtoms).toBe(MINT_AMOUNT);
    expect(s.reserveSats).toBe(1000n);
    expect(s.platformTreasurySats).toBe(10_010n);
    expect(s.balances.get(RECIPIENT)!.get(DEPLOY_TXID)!.availableAtoms).toBe(MINT_AMOUNT);
  });

  it("rejects below-minimum-contribution mint (1M tokens → 500 sats)", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, mintTx(atoms(1_000_000), 0n, 505n), CFG)).toEqual({
      valid: false,
      reason: "BELOW_MIN_CONTRIBUTION",
    });
  });

  it("rejects settlement 1 sat under / over", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, mintTx(MINT_AMOUNT, 0n, 1009n), CFG)).toEqual({
      valid: false,
      reason: "UNDERPAYMENT",
    });
    expect(validateCoveOperation(s, mintTx(MINT_AMOUNT, 0n, 1011n), CFG)).toEqual({
      valid: false,
      reason: "OVERPAYMENT",
    });
  });

  it("rejects wrong settlement script", () => {
    const s = deployedState();
    expect(
      validateCoveOperation(
        s,
        mintTx(MINT_AMOUNT, 0n, 1010n, {
          protocolOutputs: [
            { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 330n, role: "recipient" },
            { index: 2, scriptPubKeyHex: ACTOR, amountSats: 1010n, role: "settlement" },
          ],
        }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "WRONG_SETTLEMENT_SCRIPT" });
  });

  it("rejects stale supply", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, mintTx(MINT_AMOUNT, 1n, 1010n), CFG)).toEqual({
      valid: false,
      reason: "STALE_SUPPLY",
    });
  });

  it("rejects overmint beyond public supply", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, mintTx(atoms(840_000_001), 0n, 0n), CFG)).toEqual({
      valid: false,
      reason: "OVERMINT",
    });
  });

  it("rejects sub-token mint", () => {
    const s = deployedState();
    expect(validateCoveOperation(s, mintTx(1n, 0n, 1010n), CFG)).toEqual({
      valid: false,
      reason: "SUBTOKEN_MINT_UNSUPPORTED",
    });
  });

  it("rejects recipient anchor dust", () => {
    const s = deployedState();
    expect(
      validateCoveOperation(
        s,
        mintTx(MINT_AMOUNT, 0n, 1010n, {
          protocolOutputs: [
            { index: 1, scriptPubKeyHex: RECIPIENT, amountSats: 100n, role: "recipient" }, // < 330 dust
            { index: 2, scriptPubKeyHex: SETTLEMENT, amountSats: 1010n, role: "settlement" },
          ],
        }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "RECIPIENT_ANCHOR_DUST" });
  });

  it("rejects unsupported actor and malformed actor script with correct prefix", () => {
    const s = deployedState();
    expect(
      validateCoveOperation(s, mintTx(MINT_AMOUNT, 0n, 1010n, { actor: "76a914" + "11".repeat(20) + "88ac" }), CFG),
    ).toEqual({ valid: false, reason: "UNSUPPORTED_ACTOR_SCRIPT" });
    // starts with 0014 but is 23 bytes (malformed) → rejected by exact template.
    expect(
      validateCoveOperation(s, mintTx(MINT_AMOUNT, 0n, 1010n, { actor: "0014" + "aa".repeat(21) }), CFG),
    ).toEqual({ valid: false, reason: "UNSUPPORTED_ACTOR_SCRIPT" });
  });
});

describe("Cove TRANSFER (continuation model)", () => {
  function mintedState() {
    const s = deployedState();
    applyCoveOperation(s, mintTx(), CFG);
    return s;
  }

  it("accepts + applies a transfer with continuation", () => {
    const s = mintedState();
    const tx = transferTx();
    expect(validateCoveOperation(s, tx, CFG)).toEqual({ valid: true, reason: null });
    applyCoveOperation(s, tx, CFG);
    expect(s.balances.get(RECIPIENT)!.get(DEPLOY_TXID)!.availableAtoms).toBe(MINT_AMOUNT - atoms(500_000));
    expect(s.balances.get(RECIPIENT2)!.get(DEPLOY_TXID)!.availableAtoms).toBe(atoms(500_000));
  });

  it("rejects missing continuation", () => {
    const s = mintedState();
    expect(
      validateCoveOperation(
        s,
        transferTx(atoms(500_000), {
          protocolOutputs: [{ index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 294n, role: "recipient" }],
        }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "MISSING_CONTINUATION" });
  });

  it("rejects continuation to wrong script", () => {
    const s = mintedState();
    expect(
      validateCoveOperation(
        s,
        transferTx(atoms(500_000), {
          protocolOutputs: [
            { index: 1, scriptPubKeyHex: RECIPIENT2, amountSats: 294n, role: "recipient" },
            { index: 2, scriptPubKeyHex: RECIPIENT2, amountSats: 330n, role: "continuation" }, // wrong: not actor
          ],
        }),
        CFG,
      ),
    ).toEqual({ valid: false, reason: "WRONG_CONTINUATION" });
  });

  it("rejects insufficient balance", () => {
    const s = mintedState();
    expect(validateCoveOperation(s, transferTx(MINT_AMOUNT + 1n), CFG)).toEqual({
      valid: false,
      reason: "INSUFFICIENT_AVAILABLE_TOKENS",
    });
  });

  it("rejects self-transfer", () => {
    const s = mintedState();
    expect(validateCoveOperation(s, transferTx(atoms(1), { recipient: RECIPIENT }), CFG)).toEqual({
      valid: false,
      reason: "SELF_TRANSFER",
    });
  });
});
