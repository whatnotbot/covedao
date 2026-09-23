import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { s0StateV2, applyMintV2 } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import { CHAIN_BITCOIN_REGTEST, decodeV2 } from "@crclaunch/cove-wire";
import { buildDeployPsbtV3, buildMintPsbtV3, RESERVE_ANCHOR_SATS } from "./builder.js";

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
});
