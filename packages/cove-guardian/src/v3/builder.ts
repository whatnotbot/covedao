import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import {
  TOKEN_CARRIER_SATS,
  applyMintV2,
  s0StateV2,
  type CoveStateV2,
} from "@crclaunch/cove-covenant";
import { buildBackingVaultV3, type CoveVaultV3 } from "@crclaunch/cove-vault";
import {
  COVE_POLICY_V3,
  computeTokenId,
  encodeDeployV2,
  encodeMintV2,
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
  buyerInputs: ResolvedInput[];
  buyerCarrierScript: Buffer; // buyer token carrier output script
  buyerChangeScript: Buffer;
  feeScript: Buffer; // Cove protocol fee destination
  minerFeeSats: Sats;
}): MintResult {
  const { nextState, grossSats } = applyMintV2(params.prevState, params.mintAmountAtoms);
  const prevVault = buildBackingVaultV3({
    state: params.prevState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
    network: params.network,
  });
  const nextVault = buildBackingVaultV3({
    state: nextState,
    guardianXOnly: params.guardianXOnly,
    recoveryKeyXOnly: params.recoveryKeyXOnly,
    network: params.network,
  });
  const buyFeeSats = deterministicFee(grossSats, COVE_FEE_CONFIG.buyFeeBps);
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
    value: Number(RESERVE_ANCHOR_SATS + grossSats),
  });
  psbt.addOutput({ script: params.buyerCarrierScript, value: Number(TOKEN_CARRIER_SATS) });
  psbt.addOutput({ script: params.feeScript, value: Number(buyFeeSats) });

  const totalIn =
    params.prevBacking.valueSats + params.buyerInputs.reduce((s, i) => s + i.valueSats, 0n);
  const change =
    totalIn -
    (RESERVE_ANCHOR_SATS + grossSats) -
    TOKEN_CARRIER_SATS -
    buyFeeSats -
    params.minerFeeSats;
  if (change < 0n) throw new Error("insufficient buyer funds");
  if (change >= 294n) {
    psbt.addOutput({ script: params.buyerChangeScript, value: Number(change) });
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

// Re-export for convenience in the lifecycle harness.
export { grossBuy, COVE_FEE_CONFIG };
