import { describe, expect, it } from "vitest";
import {
  validateRedeemTokenAccounting,
  validateTokenTransfer,
} from "./tokenUtxo.js";

const TOKENID = Buffer.alloc(32, 0xcd);
const ATOMS = 100_000_000n;
const P2TR = Buffer.from("5120" + "ab".repeat(32), "hex");
const OP_RET = Buffer.from("6a04deadbeef", "hex");

function outputs(scripts: Buffer[]): { script: Buffer; value: number }[] {
  return scripts.map((s, i) => ({ script: s, value: 1000 + i }));
}

describe("token-UTXO transfer validator (§3)", () => {
  it("conservation: 10 → 4 + 6 passes", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [
        { vout: 0, amount: 4n * ATOMS },
        { vout: 1, amount: 6n * ATOMS },
      ],
      outputs: outputs([P2TR, P2TR]),
    });
    expect(r).toEqual({ ok: true, changeAtoms: 0n });
  });

  it("exact spend 10 → 10 passes (no change)", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [{ vout: 0, amount: 10n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r.ok).toBe(true);
  });

  it("inflation (outputs > inputs) rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [{ vout: 0, amount: 11n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "INFLATION" });
  });

  it("accidental burn (outputs < inputs) rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [{ vout: 0, amount: 9n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "BURN_OR_INCONSISTENT_CHANGE" });
  });

  it("duplicate vout rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [
        { vout: 0, amount: 5n * ATOMS },
        { vout: 0, amount: 5n * ATOMS },
      ],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "DUPLICATE_VOUT" });
  });

  it("allocation to OP_RETURN rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [{ vout: 0, amount: 10n * ATOMS }],
      outputs: outputs([OP_RET]),
    });
    expect(r).toMatchObject({ ok: false, reason: "ALLOCATION_TO_OP_RETURN" });
  });

  it("nonexistent vout rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      allocations: [{ vout: 5, amount: 10n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "ALLOCATION_VOUT_OUT_OF_RANGE" });
  });

  it("no token input rejected", () => {
    const r = validateTokenTransfer({
      tokenId: TOKENID,
      tokenInputs: [],
      allocations: [{ vout: 0, amount: 1n }],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "NO_TOKEN_INPUT" });
  });
});

describe("redeem token accounting validator", () => {
  it("redeem 6 from 10 with 4 change passes", () => {
    const r = validateRedeemTokenAccounting({
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      redeemAmountAtoms: 6n * ATOMS,
      changeAllocations: [{ vout: 0, amount: 4n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r).toEqual({ ok: true, changeAtoms: 4n * ATOMS });
  });

  it("redeem all 10 with no change passes", () => {
    const r = validateRedeemTokenAccounting({
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      redeemAmountAtoms: 10n * ATOMS,
      changeAllocations: [],
      outputs: outputs([P2TR]),
    });
    expect(r.ok).toBe(true);
  });

  it("redeem more than owned rejected", () => {
    const r = validateRedeemTokenAccounting({
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      redeemAmountAtoms: 11n * ATOMS,
      changeAllocations: [],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "REDEEM_EXCEEDS_OWNERSHIP" });
  });

  it("redeem + change != inputs rejected (burn/inflation)", () => {
    const r = validateRedeemTokenAccounting({
      tokenInputs: [{ outpoint: "aa:0", amountAtoms: 10n * ATOMS }],
      redeemAmountAtoms: 6n * ATOMS,
      changeAllocations: [{ vout: 0, amount: 3n * ATOMS }],
      outputs: outputs([P2TR]),
    });
    expect(r).toMatchObject({ ok: false, reason: "BURN_OR_INCONSISTENT_CHANGE" });
  });
});
