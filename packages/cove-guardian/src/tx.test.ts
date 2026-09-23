import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { stateOutputScript, type CoveState } from "@crclaunch/cove-covenant";
import { TaprootGuardianSigner } from "./signer.js";
import {
  RESERVE_ANCHOR_SATS,
  TOKEN_COMMITMENT_SATS,
  buildMintPsbt,
  type MintIntent,
} from "./tx.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

const WIF = "cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW";
const internalKey = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));
const MINT_42M = 42_000_000n * 100_000_000n;

const S0: CoveState = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT",
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

const RECIPIENT = Buffer.from("5120" + "cc".repeat(32), "hex");
const PLATFORM_FEE = Buffer.from("0014" + "dd".repeat(20), "hex"); // P2WPKH
const BUYER_CHANGE = Buffer.from("0014" + "ee".repeat(20), "hex"); // P2WPKH
const MINER_FEE = 1_000n;
const BUYER_FUND = 100_000n;

function intent(): MintIntent {
  return {
    prevState: S0,
    amountAtoms: MINT_42M,
    recipientCommitment: RECIPIENT,
    platformFeeScript: PLATFORM_FEE,
  };
}

function buildValid() {
  const signer = new TaprootGuardianSigner(WIF, "regtest");
  const { psbt, analysis } = buildMintPsbt({
    internalKey,
    intent: intent(),
    stateInput: {
      txid: "a".repeat(64),
      vout: 0,
      script: stateOutputScript(S0, internalKey),
      valueSats: S0.reserveSats + RESERVE_ANCHOR_SATS,
    },
    buyerInputs: [{ txid: "b".repeat(64), vout: 0, script: BUYER_CHANGE, valueSats: BUYER_FUND }],
    buyerChangeScript: BUYER_CHANGE,
    minerFeeSats: MINER_FEE,
    network: "regtest",
  });
  return { signer, psbt, analysis };
}

/** Reach into the PSBT's real (cached) transaction to mutate an output. */
function mutateOutput(
  psbt: bitcoin.Psbt,
  index: number,
  patch: { script?: Buffer; value?: number },
): void {
  const tx = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE.__TX;
  if (patch.script) tx.outs[index]!.script = patch.script;
  if (patch.value !== undefined) tx.outs[index]!.value = patch.value;
}

function addOutput(psbt: bitcoin.Psbt, script: Buffer, value: number): void {
  const tx = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE.__TX;
  tx.outs.push({ script, value });
}

function expectReject(psbt: bitcoin.Psbt, signer: TaprootGuardianSigner, reason: string): void {
  expect(() => signer.signMintTx(psbt, intent())).toThrow(new RegExp(reason));
}

describe("buildMintPsbt + validateMintTx (canonical MINT layout)", () => {
  it("builds a canonical tx that passes end-to-end validation", () => {
    const { analysis } = buildValid();
    // MINT 42M → 21,000 sats curve contribution (golden), 1% platform fee = 210.
    expect(analysis.curveContributionSats).toBe(21_000n);
    expect(analysis.platformFeeSats).toBe(210n);
    expect(analysis.minerFeeSats).toBe(MINER_FEE);
    expect(analysis.buyerChangeSats).toBe(
      BUYER_FUND - 21_000n - TOKEN_COMMITMENT_SATS - 210n - MINER_FEE,
    );
    expect(analysis.nextState.reserveSats).toBe(21_000n);
    expect(analysis.nextState.publicSupplyAtoms).toBe(MINT_42M);
  });

  it("signs the exact BIP341 sighash and the key-path signature verifies", () => {
    const { signer, psbt, analysis } = buildValid();
    const result = signer.signMintTx(psbt, intent());
    expect(result.tapKeySig.length).toBe(64);
    expect(result.analysis.curveContributionSats).toBe(analysis.curveContributionSats);

    // Q(S0) = the state output key (x-only of the tweaked key).
    const q0 = stateOutputScript(S0, internalKey).subarray(2);
    expect(ecc.verifySchnorr(result.sighash, q0, result.tapKeySig.subarray(0, 64))).toBe(true);
    // The audit digest is a DIFFERENT message, and its signature verifies under P.
    expect(result.auditDigest.equals(result.sighash)).toBe(false);
    expect(signer.verifyAuditSignature(result.auditDigest, result.auditSignature)).toBe(true);
  });
});

describe("adversarial ACTUAL-PSBT mutations (Guardian must refuse)", () => {
  it("wrong successor script", () => {
    const { signer, psbt } = buildValid();
    mutateOutput(psbt, 0, { script: Buffer.from("5120" + "ff".repeat(32), "hex") });
    expectReject(psbt, signer, "SUCCESSOR_SCRIPT_MISMATCH");
  });

  it("wrong successor BTC value", () => {
    const { signer, psbt } = buildValid();
    mutateOutput(psbt, 0, { value: Number(31_000n + 1n) });
    expectReject(psbt, signer, "RESERVE_CONTRIBUTION_MISMATCH");
  });

  it("missing reserve contribution", () => {
    const { signer, psbt } = buildValid();
    mutateOutput(psbt, 0, { value: Number(31_000n - 1_000n) });
    expectReject(psbt, signer, "RESERVE_CONTRIBUTION_MISMATCH");
  });

  it("wrong recipient", () => {
    const { signer, psbt } = buildValid();
    mutateOutput(psbt, 1, { script: Buffer.from("0014" + "11".repeat(20), "hex") });
    expectReject(psbt, signer, "RECIPIENT_OUTPUT_MISMATCH");
  });

  it("wrong fee (fee out of range)", () => {
    const { signer, psbt } = buildValid();
    // Shrink change output so miner fee balloons above MAX_FEE_SATS.
    mutateOutput(psbt, 3, { value: 1 });
    expectReject(psbt, signer, "FEE_OUT_OF_RANGE");
  });

  it("extra unauthorized output", () => {
    const { signer, psbt } = buildValid();
    addOutput(psbt, Buffer.from("0014" + "22".repeat(20), "hex"), 5_000);
    expectReject(psbt, signer, "EXTRA_UNAUTHORIZED_OUTPUT");
  });

  it("wrong prevout (no state input)", () => {
    const { signer, psbt } = buildValid();
    // Point the state input's prevout at a non-state script.
    const wu = psbt.data.inputs[0]!.witnessUtxo!;
    wu.script = Buffer.from("5120" + "ff".repeat(32), "hex");
    expectReject(psbt, signer, "STATE_INPUT_NOT_FOUND");
  });

  it("MINT when prev phase != PUBLIC_MINT", () => {
    const { signer } = buildValid();
    const graduated: CoveState = { ...S0, phase: "GRADUATED" };
    const { psbt } = buildMintPsbt({
      internalKey,
      intent: { ...intent(), prevState: graduated },
      stateInput: {
        txid: "a".repeat(64),
        vout: 0,
        script: stateOutputScript(graduated, internalKey),
        valueSats: RESERVE_ANCHOR_SATS,
      },
      buyerInputs: [{ txid: "b".repeat(64), vout: 0, script: BUYER_CHANGE, valueSats: BUYER_FUND }],
      buyerChangeScript: BUYER_CHANGE,
      minerFeeSats: MINER_FEE,
      network: "regtest",
    });
    expect(() => signer.signMintTx(psbt, { ...intent(), prevState: graduated })).toThrow(
      /PHASE_NOT_PUBLIC_MINT/,
    );
  });
});
