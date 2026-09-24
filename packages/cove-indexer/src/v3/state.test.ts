import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { applyMintV2, s0StateV2 } from "@crclaunch/cove-covenant";
import { buildBackingVaultV3 } from "@crclaunch/cove-vault";
import {
  CHAIN_BITCOIN_REGTEST,
  computeTokenId,
  encodeDeployV2,
  encodeMintV2,
  encodeRedeemV2,
  encodeTransferV2,
} from "@crclaunch/cove-wire";
import { deterministicFee, COVE_FEE_CONFIG } from "@crclaunch/cove-economics";
import { RESERVE_ANCHOR_SATS } from "./constants.js";
import { V3IndexerState } from "./state.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

const guardianXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
const feeScript = Buffer.from("0014" + "f".repeat(40), "hex");
const NONCE = Buffer.alloc(32, 0xab);
const ATOMS = 100_000_000n;
const MINT_AMOUNT = 84_000_000n * ATOMS;

function config() {
  return {
    network: "regtest" as const,
    chainIdentity: CHAIN_BITCOIN_REGTEST,
    guardianXOnly,
    recoveryKeyXOnly: recoveryXOnly,
    feeScript,
    genesisHeight: 0n,
  };
}

function opReturn(wire: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x6a, wire.length]), wire]);
}

/** Build a raw tx hex from inputs (big-endian txids) + outputs. */
function tx(ins: { txid: string; vout: number }[], outs: { script: Buffer; value: bigint }[]): string {
  const t = new bitcoin.Transaction();
  t.version = 2;
  for (const i of ins) t.addInput(Buffer.from(i.txid, "hex").reverse(), i.vout);
  for (const o of outs) t.addOutput(o.script, Number(o.value));
  return t.toHex();
}

function vaultScript(state: ReturnType<typeof s0StateV2>): Buffer {
  return buildBackingVaultV3({
    state,
    guardianXOnly,
    recoveryKeyXOnly: recoveryXOnly,
    network: bitcoin.networks.regtest,
  }).scriptPubKey;
}

function block(height: number, txs: string[]) {
  return { height: BigInt(height), hash: `b${height}`.padEnd(64, "0"), parentHash: "0".repeat(64), txs };
}

describe("V3IndexerState — deterministic lifecycle indexing (§9-§13, §14)", () => {
  it("indexes DEPLOY → MINT → TRANSFER → REDEEM → RE-BUY → P2P and rolls back", () => {
    const state = new V3IndexerState(config());
    const tokenId = computeTokenId({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const tokenIdHex = tokenId.toString("hex");
    const s0 = s0StateV2({ tokenId: tokenIdHex });

    // ── DEPLOY ──
    const deployWire = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    const deployTxid = tx(
      [{ txid: "d0".repeat(32), vout: 0 }],
      [ { script: opReturn(deployWire), value: 0n }, { script: vaultScript(s0), value: RESERVE_ANCHOR_SATS } ],
    );
    const deployHex = deployTxid;
    const deployTxidHex = bitcoin.Transaction.fromHex(deployTxid).getId();
    state.applyBlock(block(1, [deployHex]));
    expect(state.tokens.has(tokenIdHex)).toBe(true);
    expect(state.backing.get(tokenIdHex)!.state.issuedPublicSupplyAtoms).toBe(0n);

    // ── MINT 84M ──
    const minted = applyMintV2(s0, MINT_AMOUNT);
    const gross = minted.grossSats;
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.buyFeeBps);
    const mintWire = encodeMintV2({ tokenId, amount: MINT_AMOUNT, recipientVout: 2 });
    const carrierScript = Buffer.from("0014" + "a".repeat(40), "hex");
    const mintTxid = tx(
      [{ txid: deployTxidHex, vout: 1 }],
      [
        { script: opReturn(mintWire), value: 0n },
        { script: vaultScript(minted.nextState), value: RESERVE_ANCHOR_SATS + minted.nextState.backingSats },
        { script: carrierScript, value: 1_000n },
        { script: feeScript, value: fee },
      ],
    );
    const mintTxidHex = bitcoin.Transaction.fromHex(mintTxid).getId();
    state.applyBlock(block(2, [mintTxid]));
    expect(state.backing.get(tokenIdHex)!.state.issuedPublicSupplyAtoms).toBe(MINT_AMOUNT);
    expect(state.backing.get(tokenIdHex)!.state.backingSats).toBe(49_350n);
    expect(state.tokenUtxos.get(`${mintTxidHex}:2`)!.amountAtoms).toBe(MINT_AMOUNT);

    // ── TRANSFER full 84M to Bob ──
    const bobScript = Buffer.from("0014" + "b".repeat(40), "hex");
    const transferWire = encodeTransferV2({ tokenId, allocations: [{ vout: 1, amount: MINT_AMOUNT }] });
    const transferTxid = tx(
      [{ txid: mintTxidHex, vout: 2 }],
      [
        { script: opReturn(transferWire), value: 0n },
        { script: bobScript, value: 1_000n },
      ],
    );
    const transferTxidHex = bitcoin.Transaction.fromHex(transferTxid).getId();
    state.applyBlock(block(3, [transferTxid]));
    expect(state.tokenUtxos.has(`${mintTxidHex}:2`)).toBe(false);
    expect(state.tokenUtxos.get(`${transferTxidHex}:1`)!.amountAtoms).toBe(MINT_AMOUNT);
    // backing/supply unchanged
    expect(state.backing.get(tokenIdHex)!.state.backingSats).toBe(49_350n);

    // ── REDEEM full 84M (backing returns to S0) ──
    const redeemWire = encodeRedeemV2({ tokenId, redeemAmount: MINT_AMOUNT, changeAllocations: [] });
    const payoutScript = Buffer.from("0014" + "c".repeat(40), "hex");
    const redeemTxid = tx(
      [
        { txid: mintTxidHex, vout: 1 },
        { txid: transferTxidHex, vout: 1 },
      ],
      [
        { script: opReturn(redeemWire), value: 0n },
        { script: vaultScript(s0), value: RESERVE_ANCHOR_SATS },
        { script: payoutScript, value: 48_856n },
        { script: feeScript, value: 494n },
      ],
    );
    state.applyBlock(block(4, [redeemTxid]));
    expect(state.backing.get(tokenIdHex)!.state.issuedPublicSupplyAtoms).toBe(0n);
    expect(state.backing.get(tokenIdHex)!.state.backingSats).toBe(0n);
    expect(state.tokenUtxos.size).toBe(0);

    // deterministic root is stable
    const root1 = state.stateRoot();
    const root2 = state.stateRoot();
    expect(root1).toBe(root2);
    expect(root1).toHaveLength(64);

    // ── roll back REDEEM, then MINT, and re-apply ──
    state.undoBlock(4n);
    expect(state.backing.get(tokenIdHex)!.state.backingSats).toBe(49_350n);
    expect(state.tokenUtxos.get(`${transferTxidHex}:1`)!.amountAtoms).toBe(MINT_AMOUNT);
    state.applyBlock(block(4, [redeemTxid]));
    expect(state.stateRoot()).toBe(root1);
  });

  it("records INVALID Cove tx without mutating state", () => {
    const state = new V3IndexerState(config());
    // a Cove-magic OP_RETURN that is malformed (truncated)
    const badWire = Buffer.concat([Buffer.from([0x43, 0x56, 0x02, 0x03]), Buffer.alloc(2)]);
    const badTx = tx(
      [{ txid: "e0".repeat(32), vout: 0 }],
      [{ script: opReturn(badWire), value: 0n }],
    );
    const before = state.stateRoot();
    state.applyBlock(block(1, [badTx]));
    expect(state.events.length).toBe(1);
    expect(state.events[0]!.valid).toBe(false);
    expect(state.events[0]!.operation).toBeNull();
    expect(state.stateRoot()).toBe(before);
  });

  it("rejects a transfer claiming tokens not present", () => {
    const state = new V3IndexerState(config());
    const tokenId = computeTokenId({
      chainIdentity: CHAIN_BITCOIN_REGTEST,
      policyVersion: 3,
      ticker: "FROG",
      tokenNonce: NONCE,
    });
    const tokenIdHex = tokenId.toString("hex");
    // deploy so the token exists, but no token UTXOs
    const s0 = s0StateV2({ tokenId: tokenIdHex });
    const deployWire = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    const deployTx = tx(
      [{ txid: "d0".repeat(32), vout: 0 }],
      [{ script: opReturn(deployWire), value: 0n }, { script: vaultScript(s0), value: RESERVE_ANCHOR_SATS }],
    );
    state.applyBlock(block(1, [deployTx]));

    // transfer claims 84M but no token UTXO exists
    const transferWire = encodeTransferV2({ tokenId, allocations: [{ vout: 1, amount: MINT_AMOUNT }] });
    const transferTx = tx(
      [{ txid: "f0".repeat(32), vout: 0 }],
      [
        { script: opReturn(transferWire), value: 0n },
        { script: Buffer.from("0014" + "b".repeat(40), "hex"), value: 1_000n },
      ],
    );
    state.applyBlock(block(2, [transferTx]));
    const ev = state.events[state.events.length - 1]!;
    expect(ev.operation).toBe("TRANSFER");
    expect(ev.valid).toBe(false);
    expect(ev.reason).toBe("FORGED_TOKEN_INPUT");
    expect(state.tokenUtxos.size).toBe(0);
  });

  it("ignores Cove ops below the activation height, indexes at/above it (§13/§48)", () => {
    const state = new V3IndexerState({ ...config(), genesisHeight: 2n });
    const tokenId = computeTokenId({ chainIdentity: CHAIN_BITCOIN_REGTEST, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    const s0 = s0StateV2({ tokenId: tokenId.toString("hex") });
    const deployWire = encodeDeployV2({ policyVersion: 3, ticker: "FROG", tokenNonce: NONCE });
    const deployHex = tx(
      [{ txid: "d0".repeat(32), vout: 0 }],
      [
        { script: opReturn(deployWire), value: 0n },
        { script: vaultScript(s0), value: RESERVE_ANCHOR_SATS },
      ],
    );
    // Height 1 (< H=2) → ignored.
    expect(state.applyBlock(block(1, [deployHex]))).toHaveLength(0);
    expect(state.tokens.size).toBe(0);
    // Height 2 (>= H) → indexed.
    const events = state.applyBlock(block(2, [deployHex]));
    expect(events.length).toBeGreaterThan(0);
    expect(state.tokens.size).toBe(1);
  });
});
