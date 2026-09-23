import type { ChainUtxo, CovePsbt, NetworkName } from "@crclaunch/bitcoin";
import { buildUnsignedPsbt, dustThreshold, opReturnScriptData } from "@crclaunch/bitcoin";
import { ATOMS_PER_TOKEN, computePlatformFee, quoteExactTokens } from "@crclaunch/curve";
import type { Atoms } from "@crclaunch/curve";
import type { CoveConfig } from "./config.js";
import { encodeCoveDeploy, encodeCoveMint, encodeCoveTransfer } from "./envelope.js";

/** Dust-safe anchor amount for a recipient/continuation script. */
export function anchorAmount(scriptPubKeyHex: string): bigint {
  return dustThreshold(Buffer.from(scriptPubKeyHex, "hex"));
}

export interface BuildDeployParams {
  network: NetworkName;
  ticker: string;
  inputs: ChainUtxo[];
  changeAddress: string;
  feeRateSatVb: bigint;
  config: CoveConfig;
}

export interface BuildMintParams {
  network: NetworkName;
  ticker: string;
  /** Whole-display-token mint amount expressed in atoms (multiple of 1e8). */
  amountAtoms: Atoms;
  /** Confirmed supply before this mint, in atoms. */
  supplyBeforeAtoms: Atoms;
  /** Recipient scriptPubKey hex (vout 1, the token owner / future anchor). */
  recipientScriptHex: string;
  inputs: ChainUtxo[];
  changeAddress: string;
  feeRateSatVb: bigint;
  config: CoveConfig;
}

export interface BuildTransferParams {
  network: NetworkName;
  ticker: string;
  amountAtoms: Atoms;
  recipientScriptHex: string;
  /** Actor scriptPubKey hex (must equal input 0's spent-UTXO script). */
  actorScriptHex: string;
  inputs: ChainUtxo[];
  changeAddress: string;
  feeRateSatVb: bigint;
  config: CoveConfig;
}

/**
 * Build an unsigned DEPLOY PSBT. Layout:
 *   vout0 OP_RETURN (binary envelope), vout1 launch fee → treasury, vout2+ change.
 */
export function buildCoveDeployPsbt(p: BuildDeployParams): CovePsbt {
  const envelope = encodeCoveDeploy(p.ticker);
  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScriptData(envelope), valueSats: 0n },
      { script: Buffer.from(p.config.treasuryScript, "hex"), valueSats: p.config.launchFeeSats },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
    maxFeeRateSatVb: p.config.maxFeeRateSatVb,
    maxMinerFeeSats: p.config.maxMinerFeeSats,
  });
}

/**
 * Build an unsigned MINT PSBT. Curve + platform fee are recomputed here (never
 * authoritative from the caller). Combined settlement is one output.
 * Layout:
 *   vout0 OP_RETURN, vout1 recipient anchor (dust-safe),
 *   vout2 combined settlement (curve + fee → settlementScript), vout3+ change.
 */
export function buildCoveMintPsbt(p: BuildMintParams): CovePsbt {
  if (p.amountAtoms <= 0n || p.amountAtoms % ATOMS_PER_TOKEN !== 0n) {
    throw new Error("SUBTOKEN_MINT_UNSUPPORTED: amount must be a whole display token in atoms.");
  }
  const quote = quoteExactTokens({
    desiredTokens: p.amountAtoms / ATOMS_PER_TOKEN,
    currentSupply: p.supplyBeforeAtoms / ATOMS_PER_TOKEN,
  });
  const curve = quote.curveContributionSats;
  if (curve < p.config.minContributionSats) {
    throw new Error("BELOW_MIN_CONTRIBUTION: mint contribution below minimum.");
  }
  const fee = computePlatformFee(curve, p.config.primaryMintFeeBps);
  const settlement = curve + fee;

  const envelope = encodeCoveMint(p.ticker, p.amountAtoms, p.supplyBeforeAtoms);
  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScriptData(envelope), valueSats: 0n },
      { script: Buffer.from(p.recipientScriptHex, "hex"), valueSats: anchorAmount(p.recipientScriptHex) },
      { script: Buffer.from(p.config.settlementScript, "hex"), valueSats: settlement },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
    maxFeeRateSatVb: p.config.maxFeeRateSatVb,
    maxMinerFeeSats: p.config.maxMinerFeeSats,
  });
}

/**
 * Build an unsigned TRANSFER PSBT. Layout:
 *   vout0 OP_RETURN, vout1 recipient anchor (dust-safe),
 *   vout2 actor continuation (dust-safe, == actor script), vout3+ change.
 */
export function buildCoveTransferPsbt(p: BuildTransferParams): CovePsbt {
  const envelope = encodeCoveTransfer(p.ticker, p.amountAtoms);
  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScriptData(envelope), valueSats: 0n },
      { script: Buffer.from(p.recipientScriptHex, "hex"), valueSats: anchorAmount(p.recipientScriptHex) },
      { script: Buffer.from(p.actorScriptHex, "hex"), valueSats: anchorAmount(p.actorScriptHex) },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
    maxFeeRateSatVb: p.config.maxFeeRateSatVb,
    maxMinerFeeSats: p.config.maxMinerFeeSats,
  });
}
