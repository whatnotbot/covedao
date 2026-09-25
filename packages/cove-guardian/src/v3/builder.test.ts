import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { s0StateV2, applyMintV2, applyRedeemV2, TOKEN_CARRIER_SATS } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import { CHAIN_BITCOIN_REGTEST, decodeV2, discoveryAgreesWithBinary } from "@crclaunch/cove-wire";
import { deterministicFee } from "@crclaunch/cove-economics";
import {
  buildDeployPsbtV3,
  buildMintPsbtV3,
  buildRedeemPsbtV3,
  buildTransferPsbtV2,
  RESERVE_ANCHOR_SATS,
} from "./builder.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const GUARDIAN = ECPair.fromPrivateKey(Buffer.alloc(32, 0x42), {
  network: bitcoin.networks.regtest,
});
const guardianXOnly = Buffer.from(GUARDIAN.publicKey.subarray(1));
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
const NONCE = Buffer.alloc(32, 0xab);

function deploy() {
  return buildDeployPsbtV3({
    network: bitcoin.networks.regtest,
    identity: {
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    },
    guardianXOnly,
    recoveryKeyXOnly: recoveryXOnly,
    deployerInputs: [
      {
        txid: "a".repeat(64),
        vout: 0,
        script: Buffer.from("0014" + "c".repeat(20), "hex"),
        valueSats: 1_000_000n,
      },
    ],
    deployerChangeScript: Buffer.from("0014" + "c".repeat(20), "hex"),
    minerFeeSats: 1_000n,
  });
}

describe("V3 builders (offline)", () => {
  it("DEPLOY: tokenId precomputable, S0 vault value = anchor, OP_RETURN wire v2", () => {
    const d = deploy();
    expect(d.tokenId.toString("hex")).toBe(
      "4710488a0ab304fb2316e0174360a41937e1f0a81f2b26dee5a38ef79fb2d252",
    );
    expect(d.s0.issuedPublicSupplyAtoms).toBe(0n);
    expect(d.s0.backingSats).toBe(0n);
    const outs = d.psbt.txOutputs;
    expect(outs[0]!.value).toBe(0); // OP_RETURN
    expect(outs[1]!.script.equals(d.vault.scriptPubKey)).toBe(true);
    expect(outs[1]!.value).toBe(Number(RESERVE_ANCHOR_SATS));
    // decode the OP_RETURN wire (skip 6a + push).
    const wire = outs[0]!.script.subarray(2);
    const env = decodeV2(wire);
    expect(env.op).toBe(1); // DEPLOY
    expect((env as { ticker: string }).ticker).toBe("FROG");
  });

  it("MINT: successor backing = R(nextSupply), prev vault committed, wire v2 MINT", () => {
    const d = deploy();
    const mint = buildMintPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: d.s0,
      prevBacking: {
        txid: "a".repeat(64),
        vout: 1,
        script: d.vault.scriptPubKey,
        valueSats: RESERVE_ANCHOR_SATS,
      },
      mintAmountAtoms: 84_000_000n * 100_000_000n,
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      buyerInputs: [
        {
          txid: "b".repeat(64),
          vout: 0,
          script: Buffer.from("0014" + "d".repeat(20), "hex"),
          valueSats: 1_000_000n,
        },
      ],
      buyerCarrierScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      buyerChangeScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      feeScript: Buffer.from("0014" + "f".repeat(20), "hex"),
      minerFeeSats: 1_000n,
    });
    const expected = applyMintV2(d.s0, 84_000_000n * 100_000_000n);
    expect(mint.nextState.backingSats).toBe(expected.nextState.backingSats);
    expect(mint.grossSats).toBe(49_350n);
    expect(mint.buyFeeSats).toBe(494n);
    // State input spends the PREV vault (MINT leaf).
    expect(mint.psbt.data.inputs[0]!.tapMerkleRoot!.equals(mint.prevVault.merkleRoot)).toBe(true);
    // Successor output is the NEXT vault.
    expect(mint.psbt.txOutputs[1]!.script.equals(mint.nextVault.scriptPubKey)).toBe(true);
  });

  it("MINT and REDEEM leaves are distinct in the backing vault", () => {
    const v = buildBackingVaultV3({
      state: s0StateV2({ tokenId: "cd".repeat(32) }),
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
    });
    expect(v.mintLeaf.tapleafHash.equals(v.redeemLeaf.tapleafHash)).toBe(false);
  });

  it("TRANSFER: token conservation enforced, wire v2 allocations keyed by vout", () => {
    const d = deploy();
    const t = buildTransferPsbtV2({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      tokenInputs: [
        {
          txid: "c".repeat(64),
          vout: 2,
          script: Buffer.from("0014" + "a".repeat(20), "hex"),
          valueSats: TOKEN_CARRIER_SATS,
        },
      ],
      tokenInputTotalAtoms: 84_000_000n * 100_000_000n,
      tokenOutputs: [
        { script: Buffer.from("0014" + "b".repeat(20), "hex"), amountAtoms: 42_000_000n * 100_000_000n },
        { script: Buffer.from("0014" + "c".repeat(20), "hex"), amountAtoms: 42_000_000n * 100_000_000n },
      ],
      funderInputs: [
        {
          txid: "d".repeat(64),
          vout: 0,
          script: Buffer.from("0014" + "d".repeat(20), "hex"),
          valueSats: 1_000_000n,
        },
      ],
      funderChangeScript: Buffer.from("0014" + "d".repeat(20), "hex"),
      btcOutputs: [],
      minerFeeSats: 1_000n,
    });
    // [0] OP_RETURN, [1] carrier A, [2] carrier B, [3] funder change
    expect(t.psbt.txOutputs.length).toBe(4);
    expect(t.psbt.txOutputs[1]!.value).toBe(Number(TOKEN_CARRIER_SATS));
    expect(t.psbt.txOutputs[2]!.value).toBe(Number(TOKEN_CARRIER_SATS));
    const env = decodeV2(t.psbt.txOutputs[0]!.script.subarray(2));
    expect(env.op).toBe(2); // TRANSFER
    expect((env as { allocations: { vout: number; amount: bigint }[] }).allocations).toEqual([
      { vout: 1, amount: 42_000_000n * 100_000_000n },
      { vout: 2, amount: 42_000_000n * 100_000_000n },
    ]);
    // Conservation violation must throw.
    expect(() =>
      buildTransferPsbtV2({
        network: bitcoin.networks.regtest,
        tokenId: d.tokenId,
        tokenInputs: [],
        tokenInputTotalAtoms: 1n,
        tokenOutputs: [{ script: Buffer.from("0014" + "b".repeat(20), "hex"), amountAtoms: 2n }],
        funderInputs: [],
        funderChangeScript: Buffer.from("0014" + "d".repeat(20), "hex"),
        btcOutputs: [],
        minerFeeSats: 1_000n,
      }),
    ).toThrow(/conservation/);
  });

  it("REDEEM: script-path REDEEM leaf, successor backing = R(next), net = gross - fee", () => {
    const d = deploy();
    const mintAmountAtoms = 84_000_000n * 100_000_000n;
    const minted = applyMintV2(d.s0, mintAmountAtoms);
    const r = buildRedeemPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: minted.nextState,
      prevBacking: {
        txid: "e".repeat(64),
        vout: 1,
        script: buildBackingVaultV3({
          state: minted.nextState,
          guardianXOnly,
          recoveryKeyXOnly: recoveryXOnly,
        }).scriptPubKey,
        valueSats: RESERVE_ANCHOR_SATS + minted.nextState.backingSats,
      },
      redeemAmountAtoms: mintAmountAtoms,
      tokenInputs: [
        {
          txid: "f".repeat(64),
          vout: 1,
          script: Buffer.from("0014" + "e".repeat(20), "hex"),
          valueSats: TOKEN_CARRIER_SATS,
        },
      ],
      tokenInputTotalAtoms: mintAmountAtoms,
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      sellerPayoutScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      sellerChangeScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      feeScript: Buffer.from("0014" + "f".repeat(20), "hex"),
      minerFeeSats: 1_000n,
    });
    const expected = applyRedeemV2(minted.nextState, mintAmountAtoms);
    expect(r.nextState.backingSats).toBe(expected.nextState.backingSats);
    expect(r.nextState.issuedPublicSupplyAtoms).toBe(0n);
    expect(r.grossSats).toBe(49_350n);
    expect(r.redeemFeeSats).toBe(494n);
    expect(r.netSats).toBe(48_856n);
    expect(r.changeAtoms).toBe(0n);
    // State input spends the PREV vault via the REDEEM leaf.
    expect(r.psbt.data.inputs[0]!.tapMerkleRoot!.equals(r.prevVault.merkleRoot)).toBe(true);
    expect(
      r.psbt.data.inputs[0]!.tapLeafScript![0]!.script.equals(r.prevVault.redeemLeaf.script),
    ).toBe(true);
    // [0] OP_RETURN, [1] successor vault, [2] payout, [3] fee (no change carrier, no BTC change).
    expect(r.psbt.txOutputs[1]!.script.equals(r.nextVault.scriptPubKey)).toBe(true);
    expect(r.psbt.txOutputs[2]!.value).toBe(48_856);
    const env = decodeV2(r.psbt.txOutputs[0]!.script.subarray(2));
    expect(env.op).toBe(4); // REDEEM
    expect((env as { redeemAmount: bigint }).redeemAmount).toBe(mintAmountAtoms);
  });

  it("MINT: protocol fee schedule is parameterized (profile-driven), not the dev default", () => {
    const d = deploy();
    const mintAmountAtoms = 84_000_000n * 100_000_000n;
    const gross = applyMintV2(d.s0, mintAmountAtoms).grossSats;
    const mint = buildMintPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: d.s0,
      prevBacking: { txid: "a".repeat(64), vout: 1, script: d.vault.scriptPubKey, valueSats: RESERVE_ANCHOR_SATS },
      mintAmountAtoms,
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      buyerInputs: [{ txid: "b".repeat(64), vout: 0, script: Buffer.from("0014" + "d".repeat(20), "hex"), valueSats: 1_000_000n }],
      buyerCarrierScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      buyerChangeScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      feeScript: Buffer.from("0014" + "f".repeat(20), "hex"),
      minerFeeSats: 1_000n,
      buyFeeBps: 50n,
    });
    expect(mint.buyFeeSats).toBe(deterministicFee(gross, 50n));
    expect(mint.buyFeeSats).not.toBe(494n); // the dev default (100 bps)
  });

  it("REDEEM: protocol fee schedule is parameterized (profile-driven), not the dev default", () => {
    const d = deploy();
    const minted = applyMintV2(d.s0, 84_000_000n * 100_000_000n);
    const gross = applyRedeemV2(minted.nextState, 84_000_000n * 100_000_000n).grossSats;
    const r = buildRedeemPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: minted.nextState,
      prevBacking: { txid: "e".repeat(64), vout: 1, script: buildBackingVaultV3({ state: minted.nextState, guardianXOnly, recoveryKeyXOnly: recoveryXOnly }).scriptPubKey, valueSats: RESERVE_ANCHOR_SATS + minted.nextState.backingSats },
      redeemAmountAtoms: 84_000_000n * 100_000_000n,
      tokenInputs: [{ txid: "f".repeat(64), vout: 1, script: Buffer.from("0014" + "e".repeat(20), "hex"), valueSats: TOKEN_CARRIER_SATS }],
      tokenInputTotalAtoms: 84_000_000n * 100_000_000n,
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      sellerPayoutScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      sellerChangeScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      feeScript: Buffer.from("0014" + "f".repeat(20), "hex"),
      minerFeeSats: 1_000n,
      redeemFeeBps: 50n,
    });
    expect(r.redeemFeeSats).toBe(deterministicFee(gross, 50n));
    expect(r.redeemFeeSats).not.toBe(494n); // the dev default (100 bps)
  });
});

describe("crc-20 discovery envelope in the built PSBT (§D1)", () => {
  function mintWith(discoveryEnvelope?: { ticker: string }) {
    const d = deploy();
    return buildMintPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: d.s0,
      prevBacking: {
        txid: "a".repeat(64),
        vout: 1,
        script: d.vault.scriptPubKey,
        valueSats: RESERVE_ANCHOR_SATS,
      },
      mintAmountAtoms: 84_000_000n * 100_000_000n,
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      buyerInputs: [
        {
          txid: "b".repeat(64),
          vout: 0,
          script: Buffer.from("0014" + "d".repeat(20), "hex"),
          valueSats: 1_000_000n,
        },
      ],
      buyerCarrierScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      buyerChangeScript: Buffer.from("0014" + "e".repeat(20), "hex"),
      feeScript: Buffer.from("0014" + "f".repeat(20), "hex"),
      minerFeeSats: 1_000n,
      discoveryEnvelope,
    });
  }

  it("is ABSENT by default — the dual envelope is opt-in", () => {
    const outs = mintWith().psbt.txOutputs;
    const nulldata = outs.filter((o) => o.script[0] === 0x6a);
    expect(nulldata).toHaveLength(1);
    expect(outs[0]!.script[0]).toBe(0x6a);
  });

  it("when enabled, appends exactly one extra OP_RETURN as the LAST output", () => {
    const withOut = mintWith().psbt.txOutputs.length;
    const outs = mintWith({ ticker: "FROG" }).psbt.txOutputs;

    expect(outs).toHaveLength(withOut + 1);

    const last = outs[outs.length - 1]!;
    expect(last.script[0]).toBe(0x6a);
    expect(last.value).toBe(0);
    expect(Buffer.from(last.script).subarray(2).toString("utf8")).toBe(
      '{"p":"crc-20","op":"mint","tick":"FROG","amt":"8400000000000000"}',
    );
  });

  it("leaves vout 0 and every fixed-index output untouched", () => {
    const plain = mintWith().psbt.txOutputs;
    const dual = mintWith({ ticker: "FROG" }).psbt.txOutputs;
    for (let i = 0; i < plain.length; i++) {
      expect(Buffer.from(dual[i]!.script).equals(Buffer.from(plain[i]!.script)), `vout ${i}`).toBe(true);
      expect(dual[i]!.value, `vout ${i} value`).toBe(plain[i]!.value);
    }
  });

  it("the appended payload is the canonical re-derivation the Guardian will demand", () => {
    const outs = mintWith({ ticker: "FROG" }).psbt.txOutputs;
    const binary = decodeV2(Buffer.from(outs[0]!.script).subarray(2));
    const payload = Buffer.from(outs[outs.length - 1]!.script).subarray(2);
    expect(discoveryAgreesWithBinary(payload, binary, "FROG")).toBe(true);
    expect(discoveryAgreesWithBinary(payload, binary, "DOGE")).toBe(false);
  });
});

/**
 * The miner fee used to come only from the seller's token carriers, which are
 * 1,000 sats each. That made a partial redeem from a single carrier
 * arithmetically impossible and capped the fee for every redeem at roughly
 * `carriers × 1000` — so redemption stopped working above a few sat/vB.
 */
describe("REDEEM miner-fee funding", () => {
  const SELLER = Buffer.from("0014" + "e".repeat(20), "hex");
  const FEE = Buffer.from("0014" + "f".repeat(20), "hex");

  function redeem(opts: {
    redeemAmountAtoms: bigint;
    carriers: number;
    minerFeeSats: bigint;
    funderSats?: bigint;
  }) {
    const d = deploy();
    const mintAmountAtoms = 84_000_000n * 100_000_000n;
    const minted = applyMintV2(d.s0, mintAmountAtoms);
    const per = mintAmountAtoms / BigInt(opts.carriers);
    return buildRedeemPsbtV3({
      network: bitcoin.networks.regtest,
      tokenId: d.tokenId,
      prevState: minted.nextState,
      prevBacking: {
        txid: "e".repeat(64),
        vout: 1,
        script: buildBackingVaultV3({
          state: minted.nextState,
          guardianXOnly,
          recoveryKeyXOnly: recoveryXOnly,
        }).scriptPubKey,
        valueSats: RESERVE_ANCHOR_SATS + minted.nextState.backingSats,
      },
      redeemAmountAtoms: opts.redeemAmountAtoms,
      tokenInputs: Array.from({ length: opts.carriers }, (_, i) => ({
        txid: String(i).repeat(64).slice(0, 64),
        vout: 1,
        script: SELLER,
        valueSats: TOKEN_CARRIER_SATS,
      })),
      tokenInputTotalAtoms: per * BigInt(opts.carriers),
      guardianXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      sellerPayoutScript: SELLER,
      sellerChangeScript: SELLER,
      feeScript: FEE,
      minerFeeSats: opts.minerFeeSats,
      funderInputs: opts.funderSats
        ? [{ txid: "b".repeat(64), vout: 0, script: SELLER, valueSats: opts.funderSats }]
        : undefined,
      funderChangeScript: SELLER,
    });
  }

  const HALF = 42_000_000n * 100_000_000n;
  const ALL = 84_000_000n * 100_000_000n;

  it("still refuses a partial redeem from one carrier when nothing funds the fee", () => {
    // 1,000 carrier − 1,000 change carrier − 1,000 fee = −1,000.
    expect(() => redeem({ redeemAmountAtoms: HALF, carriers: 1, minerFeeSats: 1_000n })).toThrow(
      /insufficient redeem funds/,
    );
  });

  it("allows that same partial redeem once a BTC input funds the fee", () => {
    const r = redeem({
      redeemAmountAtoms: HALF,
      carriers: 1,
      minerFeeSats: 1_000n,
      funderSats: 10_000n,
    });
    expect(r.changeAtoms).toBe(HALF);
    expect(r.grossSats).toBeGreaterThan(0n);
  });

  it("names the shortfall instead of failing blankly", () => {
    expect(() => redeem({ redeemAmountAtoms: HALF, carriers: 1, minerFeeSats: 1_000n })).toThrow(
      /add a BTC funding input/,
    );
  });

  it("supports a miner fee far above what carriers alone could pay", () => {
    // ~30 sat/vB on a 400 vB redeem. Four carriers hold only 4,000 sats.
    const r = redeem({
      redeemAmountAtoms: ALL,
      carriers: 4,
      minerFeeSats: 12_000n,
      funderSats: 50_000n,
    });
    expect(r.netSats).toBe(48_856n);
  });

  it("refuses that fee without a funder, as before", () => {
    expect(() => redeem({ redeemAmountAtoms: ALL, carriers: 4, minerFeeSats: 12_000n })).toThrow(
      /insufficient redeem funds/,
    );
  });
});
