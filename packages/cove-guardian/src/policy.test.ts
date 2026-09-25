import { describe, expect, it } from "vitest";
import { applyMint, type CoveState } from "@crclaunch/cove-covenant";
import { validateMint, validateStateInvariants } from "./policy.js";

const S0: CoveState = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT",
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

/** One stair: 100,000 tokens. */
const MINT_42M = 100_000n * 100_000_000n;
const RECIPIENT = Buffer.from("5120" + "cc".repeat(32), "hex"); // valid P2TR

function validContext(): Parameters<typeof validateMint>[0] {
  const r = applyMint(S0, MINT_42M);
  return {
    prevState: S0,
    nextState: r.nextState,
    amountAtoms: MINT_42M,
    curveContributionSats: r.curveContributionSats,
    feeSats: 1_000n,
    recipientCommitment: RECIPIENT,
    network: "regtest",
  };
}

describe("Guardian policy (validateMint)", () => {
  it("accepts a valid MINT transition", () => {
    expect(validateMint(validContext()).ok).toBe(true);
  });

  it("rejects a manipulated successor state (supply)", () => {
    const c = validContext();
    c.nextState = { ...c.nextState, publicSupplyAtoms: c.nextState.publicSupplyAtoms + 1n };
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "SUPPLY_CONSERVATION" });
  });

  it("rejects a manipulated successor state (reserve)", () => {
    const c = validContext();
    c.nextState = { ...c.nextState, reserveSats: c.nextState.reserveSats + 1n };
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "RESERVE_MOVEMENT" });
  });

  it("rejects a manipulated payment", () => {
    const c = validContext();
    c.curveContributionSats = c.curveContributionSats + 1n;
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "PAYMENT_MISMATCH" });
  });

  it("rejects a malformed recipient commitment", () => {
    const c = validContext();
    c.recipientCommitment = Buffer.from("deadbeef", "hex");
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "RECIPIENT_MALFORMED" });
  });

  it("rejects a zero amount", () => {
    const c = validContext();
    c.amountAtoms = 0n;
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "ZERO_AMOUNT" });
  });

  it("rejects an over-supply mint", () => {
    const c = validContext();
    c.amountAtoms = 21_000_001n * 100_000_000n;
    c.nextState = {
      ...S0,
      publicSupplyAtoms: 21_000_001n * 100_000_000n,
      reserveSats: 0n,
      curveStage: 20,
    };
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "OVERMINT" });
  });

  it("rejects a fee out of range", () => {
    const c = validContext();
    c.feeSats = 100_000n;
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "FEE_OUT_OF_RANGE" });
  });

  it("rejects mainnet (not activated)", () => {
    const c = validContext();
    c.network = "mainnet";
    expect(validateMint(c)).toMatchObject({ ok: false, reason: "MAINNET_NOT_ACTIVATED" });
  });
});

describe("validateStateInvariants", () => {
  it("accepts a canonical S0", () => {
    expect(validateStateInvariants(S0, "MINT")).toEqual({ ok: true });
  });

  it("rejects a non-PUBLIC_MINT phase for MINT", () => {
    expect(validateStateInvariants({ ...S0, phase: "GRADUATED" }, "MINT")).toMatchObject({
      ok: false,
      reason: "PHASE_NOT_PUBLIC_MINT",
    });
  });

  it("rejects an over-cap supply", () => {
    expect(
      validateStateInvariants({ ...S0, publicSupplyAtoms: 21_000_001n * 100_000_000n }),
    ).toMatchObject({ ok: false, reason: "SUPPLY_OUT_OF_RANGE" });
  });

  it("rejects a sub-token (non-atomic) supply", () => {
    expect(validateStateInvariants({ ...S0, publicSupplyAtoms: 1n })).toMatchObject({
      ok: false,
      reason: "SUPPLY_NOT_ATOMIC",
    });
  });

  it("rejects a curveStage inconsistent with supply", () => {
    expect(
      validateStateInvariants({ ...S0, publicSupplyAtoms: MINT_42M, curveStage: 1 }),
    ).toMatchObject({ ok: false, reason: "CURVE_STAGE_MISMATCH" });
  });

  it("rejects an invalid tokenId", () => {
    expect(validateStateInvariants({ ...S0, tokenId: "00".repeat(32) })).toMatchObject({
      ok: false,
      reason: "INVALID_TOKEN_ID",
    });
  });

  it("rejects a negative reserve", () => {
    expect(validateStateInvariants({ ...S0, reserveSats: -1n })).toMatchObject({
      ok: false,
      reason: "RESERVE_NEGATIVE",
    });
  });
});
