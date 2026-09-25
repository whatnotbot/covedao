import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import {
  TOKEN_CARRIER_SATS,
  applyMintV2,
  applyRedeemV2,
  s0StateV2,
  type CoveStateV2,
} from "@crclaunch/cove-covenant";
import { buildBackingVaultV3, type CoveVaultV3, type VaultRecoveryProfile } from "@crclaunch/cove-vault";
import {
  COVE_POLICY_V3,
  computeTokenId,
  encodeDeployV2,
  encodeMintV2,
  encodeDiscovery,
  decodeV2,
  encodeRedeemV2,
  encodeTransferV2,
  type TokenIdentityInput,
} from "@crclaunch/cove-wire";
import { grossBuy } from "@crclaunch/cove-economics";
import { deterministicFee, COVE_FEE_CONFIG } from "@crclaunch/cove-economics";
import type { Sats } from "@crclaunch/curve";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/** Fixed non-reserve satoshi anchor carried by every backing state UTXO. */
export const RESERVE_ANCHOR_SATS = 10_000n;

export interface ResolvedInput {
  txid: string;
  vout: number;
  script: Buffer;
  valueSats: Sats;
}

export interface DeployResult {
  psbt: bitcoin.Psbt;
  tokenId: Buffer;
  s0: CoveStateV2;
  vault: CoveVaultV3;
  wire: Buffer;
}

/**
 * Build a real DEPLOY PSBT (§8). Canonical outputs: [0] OP_RETURN (wire v2
 * DEPLOY), [1] S0 backing vault (RESERVE_ANCHOR_SATS, backing=0), [2] deployer
 * change. tokenId is derived pre-transaction (never the txid).
 */
export function buildDeployPsbtV3(params: {
  network: bitcoin.networks.Network;
  identity: TokenIdentityInput;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  deployerInputs: ResolvedInput[];
  deployerChangeScript: Buffer;
  minerFeeSats: Sats;
}): DeployResult {
  const tokenId = computeTokenId(params.identity);
  const tokenIdHex = tokenId.toString("hex");
  const s0 = s0StateV2({ tokenId: tokenIdHex });
  const vault = buildBackingVaultV3({
    state: s0,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
      recoveryProfile: params.recoveryProfile,
    network: params.network,
  });
  const wire = encodeDeployV2({
    policyVersion: COVE_POLICY_V3,
    ticker: params.identity.ticker,
    tokenNonce: params.identity.tokenNonce,
  });

  const psbt = new bitcoin.Psbt({ network: params.network });
  for (const input of params.deployerInputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: { script: input.script, value: Number(input.valueSats) },
    });
  }
  psbt.addOutput({ script: Buffer.concat([Buffer.from([0x6a, wire.length]), wire]), value: 0 });
  psbt.addOutput({ script: vault.scriptPubKey, value: Number(RESERVE_ANCHOR_SATS) });

  const totalIn = params.deployerInputs.reduce((s, i) => s + i.valueSats, 0n);
  const change = totalIn - RESERVE_ANCHOR_SATS - params.minerFeeSats;
  if (change < 0n) throw new Error("insufficient deployer funds");
  if (change >= 546n) {
    psbt.addOutput({ script: params.deployerChangeScript, value: Number(change) });
  }

  return { psbt, tokenId, s0, vault, wire };
}

export interface MintResult {
  psbt: bitcoin.Psbt;
  prevVault: CoveVaultV3;
  nextState: CoveStateV2;
  nextVault: CoveVaultV3;
  grossSats: Sats;
  buyFeeSats: Sats;
  wire: Buffer;
  stateInputIndex: number;
}

/**
 * Build a real MINT/backing-buy PSBT (§9). Canonical outputs: [0] OP_RETURN,
 * [1] successor backing vault, [2] buyer token carrier, [3] Cove buy fee,
 * [4] buyer BTC change. The state input (index 0) is signed script-path by the
 * Guardian; the buyer funds BTC + carrier sats + fee + miner fee.
 */
export function buildMintPsbtV3(params: {
  network: bitcoin.networks.Network;
  tokenId: Buffer;
  prevState: CoveStateV2;
  prevBacking: ResolvedInput; // { txid, vout, script: vault.scriptPubKey, valueSats }
  mintAmountAtoms: bigint;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  buyerInputs: ResolvedInput[];
  buyerCarrierScript: Buffer; // buyer token carrier output script
  buyerChangeScript: Buffer;
  feeScript: Buffer; // Cove protocol fee destination
  minerFeeSats: Sats;
  /** Protocol fee schedule (bps). Defaults to the development COVE_FEE_CONFIG. */
  buyFeeBps?: bigint;
  /**
   * Emit the advisory `crc-20` discovery envelope as a trailing OP_RETURN
   * (§D1). OPT-IN: it needs two OP_RETURNs in one transaction, which Bitcoin
   * Core rejects as `multi-op-return` before v30 relaxed the datacarrier
   * policy. Leave it off for a deployment that must relay through older nodes.
   */
  discoveryEnvelope?: { ticker: string };
}): MintResult {
  const { nextState, grossSats } = applyMintV2(params.prevState, params.mintAmountAtoms);
  const prevVault = buildBackingVaultV3({
    state: params.prevState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
      recoveryProfile: params.recoveryProfile,
    network: params.network,
  });
  const nextVault = buildBackingVaultV3({
    state: nextState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
      recoveryProfile: params.recoveryProfile,
    network: params.network,
  });
  const buyFeeSats = deterministicFee(grossSats, params.buyFeeBps ?? COVE_FEE_CONFIG.buyFeeBps);
  const wire = encodeMintV2({
    tokenId: params.tokenId,
    amount: params.mintAmountAtoms,
    recipientVout: 2,
  });

  const psbt = new bitcoin.Psbt({ network: params.network });
  psbt.addInput({
    hash: params.prevBacking.txid,
    index: params.prevBacking.vout,
    witnessUtxo: { script: params.prevBacking.script, value: Number(params.prevBacking.valueSats) },
    tapInternalKey: prevVault.numsKey,
    tapMerkleRoot: prevVault.merkleRoot,
    tapLeafScript: [
      {
        leafVersion: 0xc0,
        script: prevVault.mintLeaf.script,
        controlBlock: prevVault.mintControlBlock,
      },
    ],
  });
  for (const input of params.buyerInputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: { script: input.script, value: Number(input.valueSats) },
    });
  }

  psbt.addOutput({ script: Buffer.concat([Buffer.from([0x6a, wire.length]), wire]), value: 0 });
  psbt.addOutput({
    script: nextVault.scriptPubKey,
    value: Number(RESERVE_ANCHOR_SATS + nextState.backingSats),
  });
  psbt.addOutput({ script: params.buyerCarrierScript, value: Number(TOKEN_CARRIER_SATS) });
  psbt.addOutput({ script: params.feeScript, value: Number(buyFeeSats) });

  const totalIn =
    params.prevBacking.valueSats + params.buyerInputs.reduce((s, i) => s + i.valueSats, 0n);
  const change =
    totalIn -
    (RESERVE_ANCHOR_SATS + nextState.backingSats) -
    TOKEN_CARRIER_SATS -
    buyFeeSats -
    params.minerFeeSats;
  if (change < 0n) throw new Error("insufficient buyer funds");
  if (change >= 294n) {
    psbt.addOutput({ script: params.buyerChangeScript, value: Number(change) });
  }

  // Advisory crc-20 discovery envelope, ALWAYS last so every fixed-index output
  // check above is unaffected. Derived from the same binary envelope the
  // validator re-derives, so the two can never disagree.
  if (params.discoveryEnvelope) {
    const discovery = encodeDiscovery(decodeV2(wire), params.discoveryEnvelope.ticker);
    psbt.addOutput({
      script: Buffer.concat([Buffer.from([0x6a, discovery.length]), discovery]),
      value: 0,
    });
  }

  return {
    psbt,
    prevVault,
    nextState,
    nextVault,
    grossSats,
    buyFeeSats,
    wire,
    stateInputIndex: 0,
  };
}

export interface TransferResult {
  psbt: bitcoin.Psbt;
  wire: Buffer;
  /** wire-v2 TRANSFER allocations, keyed by FINAL output vout. */
  allocations: { vout: number; amount: bigint }[];
  /** Token carrier outputs actually created (vout, script, amount). */
  tokenOutputs: { vout: number; script: Buffer; amountAtoms: bigint }[];
}

/**
 * Build a real TRANSFER PSBT (§10). Ordinary Bitcoin — no backing, no Guardian.
 * Canonical outputs: [0] OP_RETURN (wire v2 TRANSFER), [1..n] token carrier
 * outputs (one per allocation), then any BTC outputs (e.g. P2P payment + fee),
 * then funder change. Token conservation is enforced here and re-verified by the
 * resolver. Backing/supply are NOT touched by a transfer.
 */
export function buildTransferPsbtV2(params: {
  network: bitcoin.networks.Network;
  tokenId: Buffer;
  tokenInputs: ResolvedInput[];
  /** Sum of token amounts (atoms) on tokenInputs, resolved from the chain view. */
  tokenInputTotalAtoms: bigint;
  /** Token outputs (recipient + change); sum must equal tokenInputTotalAtoms. */
  tokenOutputs: { script: Buffer; amountAtoms: bigint }[];
  /** Ordinary BTC inputs funding carriers + BTC outputs + miner fee. */
  funderInputs: ResolvedInput[];
  funderChangeScript: Buffer;
  /** BTC outputs in addition to the carrier outputs (P2P payment, p2p fee, …). */
  btcOutputs: { script: Buffer; valueSats: Sats }[];
  minerFeeSats: Sats;
}): TransferResult {
  if (params.tokenOutputs.length === 0) throw new Error("no token outputs");
  if (params.tokenOutputs.length > 4) throw new Error("max 4 token outputs");
  const tokenOutTotal = params.tokenOutputs.reduce((s, o) => s + o.amountAtoms, 0n);
  if (tokenOutTotal !== params.tokenInputTotalAtoms)
    throw new Error(
      `token conservation violated: in=${params.tokenInputTotalAtoms} out=${tokenOutTotal}`,
    );

  let vout = 0;
  const wire = encodeTransferV2({
    tokenId: params.tokenId,
    allocations: params.tokenOutputs.map((o) => ({ vout: ++vout, amount: o.amountAtoms })),
  });

  const psbt = new bitcoin.Psbt({ network: params.network });
  for (const input of [...params.tokenInputs, ...params.funderInputs]) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: { script: input.script, value: Number(input.valueSats) },
    });
  }

  psbt.addOutput({ script: Buffer.concat([Buffer.from([0x6a, wire.length]), wire]), value: 0 });
  const tokenOutputs: TransferResult["tokenOutputs"] = [];
  for (const o of params.tokenOutputs) {
    tokenOutputs.push({ vout: psbt.txOutputs.length, script: o.script, amountAtoms: o.amountAtoms });
    psbt.addOutput({ script: o.script, value: Number(TOKEN_CARRIER_SATS) });
  }
  for (const o of params.btcOutputs) {
    psbt.addOutput({ script: o.script, value: Number(o.valueSats) });
  }

  const totalIn = [...params.tokenInputs, ...params.funderInputs].reduce(
    (s, i) => s + i.valueSats,
    0n,
  );
  const carriersOut = BigInt(params.tokenOutputs.length) * TOKEN_CARRIER_SATS;
  const btcOut = params.btcOutputs.reduce((s, o) => s + o.valueSats, 0n);
  const change = totalIn - carriersOut - btcOut - params.minerFeeSats;
  if (change < 0n) throw new Error("insufficient transfer funds");
  if (change >= 294n) {
    psbt.addOutput({ script: params.funderChangeScript, value: Number(change) });
  }

  const allocations = params.tokenOutputs.map((o, i) => ({ vout: i + 1, amount: o.amountAtoms }));
  return { psbt, wire, allocations, tokenOutputs };
}

export interface RedeemResult {
  psbt: bitcoin.Psbt;
  prevVault: CoveVaultV3;
  nextState: CoveStateV2;
  nextVault: CoveVaultV3;
  grossSats: Sats;
  redeemFeeSats: Sats;
  netSats: Sats;
  changeAtoms: bigint;
  wire: Buffer;
}

/**
 * Build a real REDEEM PSBT (§11). Script-path REDEEM execution leaf (analogous
 * to MINT). Canonical outputs: [0] OP_RETURN (wire v2 REDEEM), [1] successor
 * backing vault, [2] seller BTC payout (net = gross - fee), [3] Cove redeem fee,
 * [4] token change carrier (only if partial redeem), [5] seller BTC change.
 */
export function buildRedeemPsbtV3(params: {
  network: bitcoin.networks.Network;
  tokenId: Buffer;
  prevState: CoveStateV2;
  prevBacking: ResolvedInput;
  redeemAmountAtoms: bigint;
  tokenInputs: ResolvedInput[];
  tokenInputTotalAtoms: bigint;
  guardianXOnly: Buffer;
  recoveryKeyXOnly: Buffer;
  recoveryProfile?: VaultRecoveryProfile;
  sellerPayoutScript: Buffer;
  sellerChangeScript: Buffer;
  feeScript: Buffer;
  minerFeeSats: Sats;
  /** Protocol fee schedule (bps). Defaults to the development COVE_FEE_CONFIG. */
  redeemFeeBps?: bigint;
}): RedeemResult {
  const { nextState, grossSats } = applyRedeemV2(params.prevState, params.redeemAmountAtoms);
  const prevVault = buildBackingVaultV3({
    state: params.prevState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
      recoveryProfile: params.recoveryProfile,
    network: params.network,
  });
  const nextVault = buildBackingVaultV3({
    state: nextState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
      recoveryProfile: params.recoveryProfile,
    network: params.network,
  });
  const redeemFeeSats = deterministicFee(grossSats, params.redeemFeeBps ?? COVE_FEE_CONFIG.redeemFeeBps);
  const netSats = grossSats - redeemFeeSats;
  const changeAtoms = params.tokenInputTotalAtoms - params.redeemAmountAtoms;
  if (changeAtoms < 0n) throw new Error("redeem exceeds token input");

  const changeCarrierVout = 4; // [0] OP_RETURN, [1] vault, [2] payout, [3] fee, [4] change carrier
  const wire = encodeRedeemV2({
    tokenId: params.tokenId,
    redeemAmount: params.redeemAmountAtoms,
    changeAllocations: changeAtoms > 0n ? [{ vout: changeCarrierVout, amount: changeAtoms }] : [],
  });

  const psbt = new bitcoin.Psbt({ network: params.network });
  psbt.addInput({
    hash: params.prevBacking.txid,
    index: params.prevBacking.vout,
    witnessUtxo: { script: params.prevBacking.script, value: Number(params.prevBacking.valueSats) },
    tapInternalKey: prevVault.numsKey,
    tapMerkleRoot: prevVault.merkleRoot,
    tapLeafScript: [
      {
        leafVersion: 0xc0,
        script: prevVault.redeemLeaf.script,
        controlBlock: prevVault.redeemControlBlock,
      },
    ],
  });
  for (const input of params.tokenInputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: { script: input.script, value: Number(input.valueSats) },
    });
  }

  psbt.addOutput({ script: Buffer.concat([Buffer.from([0x6a, wire.length]), wire]), value: 0 });
  psbt.addOutput({
    script: nextVault.scriptPubKey,
    value: Number(RESERVE_ANCHOR_SATS + nextState.backingSats),
  });
  psbt.addOutput({ script: params.sellerPayoutScript, value: Number(netSats) });
  psbt.addOutput({ script: params.feeScript, value: Number(redeemFeeSats) });
  if (changeAtoms > 0n) {
    psbt.addOutput({ script: params.sellerChangeScript, value: Number(TOKEN_CARRIER_SATS) });
  }

  const totalIn =
    params.prevBacking.valueSats + params.tokenInputs.reduce((s, i) => s + i.valueSats, 0n);
  const successorValue = RESERVE_ANCHOR_SATS + nextState.backingSats;
  const changeCarrierValue = changeAtoms > 0n ? TOKEN_CARRIER_SATS : 0n;
  const change = totalIn - successorValue - netSats - redeemFeeSats - changeCarrierValue - params.minerFeeSats;
  if (change < 0n) throw new Error("insufficient redeem funds");
  if (change >= 294n) {
    psbt.addOutput({ script: params.sellerChangeScript, value: Number(change) });
  }

  return {
    psbt,
    prevVault,
    nextState,
    nextVault,
    grossSats,
    redeemFeeSats,
    netSats,
    changeAtoms,
    wire,
  };
}

// Re-export for convenience in the lifecycle harness.
export { grossBuy, COVE_FEE_CONFIG };
