import { describe, expect, it } from "vitest";
import { applyMint, type CoveState } from "@crclaunch/cove-covenant";
import { validateMint } from "./policy.js";
import { TaprootGuardianSigner, transitionDigest } from "./signer.js";

const S0: CoveState = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT",
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

const MINT_42M = 42_000_000n * 100_000_000n;
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

  it("rejects a manipulated recipient commitment", () => {
    const c = validContext();
    c.recipientCommitment = Buffer.from("0014" + "00".repeat(20), "hex"); // valid P2WPKH but wrong? still well-formed
    // A malformed (non-P2TR/P2WPKH) commitment must be rejected.
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
    c.amountAtoms = 840_000_001n * 100_000_000n;
    c.nextState = {
      ...S0,
      publicSupplyAtoms: 840_000_001n * 100_000_000n,
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

describe("Guardian signer (authorizeMint)", () => {
  const WIF = "cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW";

  it("signs a valid transition and the signature verifies", () => {
    const signer = new TaprootGuardianSigner(WIF, "regtest");
    const auth = signer.authorizeMint(validContext());
    expect(auth.signature.length).toBe(64);
    expect(auth.digest.equals(transitionDigest(validContext()))).toBe(true);
    expect(signer.verifyAuthorization(auth)).toBe(true);
  });

  it("refuses to sign a manipulated successor state", () => {
    const signer = new TaprootGuardianSigner(WIF, "regtest");
    const c = validContext();
    c.nextState = { ...c.nextState, publicSupplyAtoms: c.nextState.publicSupplyAtoms + 1n };
    expect(() => signer.authorizeMint(c)).toThrow();
  });

  it("refuses to sign a manipulated payment", () => {
    const signer = new TaprootGuardianSigner(WIF, "regtest");
    const c = validContext();
    c.curveContributionSats = c.curveContributionSats + 1n;
    expect(() => signer.authorizeMint(c)).toThrow();
  });

  it("refuses to sign a manipulated recipient", () => {
    const signer = new TaprootGuardianSigner(WIF, "regtest");
    const c = validContext();
    c.recipientCommitment = Buffer.from("deadbeef", "hex");
    expect(() => signer.authorizeMint(c)).toThrow();
  });
});
