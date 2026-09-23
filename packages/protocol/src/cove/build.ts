import type { ChainUtxo, CovePsbt, NetworkName } from "@crclaunch/bitcoin";
import { buildUnsignedPsbt, opReturnScript } from "@crclaunch/bitcoin";
import { computePlatformFee, quoteExactTokens } from "@crclaunch/curve";
import type { TokenAtoms } from "@crclaunch/curve";
import type { CoveConfig } from "./validator.js";

/**
 * V1 dust amount for the recipient output (mint/transfer vout 1). Above the
 * P2WPKH/P2TR dust threshold so the recipient output is relayable, and it is
 * NOT part of the token transfer — token balances live in the indexer state,
 * not in the recipient's satoshi value.
 */
export const RECIPIENT_DUST_SATS = 546n;

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
  /** Whole tokens to mint (the canonical curve unit). */
  amountTokens: TokenAtoms;
  /** Whole tokens confirmed before this mint (the "s" field). */
  supplyBeforeTokens: TokenAtoms;
  /** Recipient scriptPubKey hex for vout 1 (P2WPKH / P2TR). */
  recipientScriptHex: string;
  inputs: ChainUtxo[];
  changeAddress: string;
  feeRateSatVb: bigint;
  config: CoveConfig;
}

export interface BuildTransferParams {
  network: NetworkName;
  ticker: string;
  amountTokens: TokenAtoms;
  recipientScriptHex: string;
  inputs: ChainUtxo[];
  changeAddress: string;
  feeRateSatVb: bigint;
}

/**
 * Build an unsigned DEPLOY PSBT. Layout:
 *   vout0 OP_RETURN, vout1 launch fee → treasury, vout2+ change.
 */
export function buildCoveDeployPsbt(p: BuildDeployParams): CovePsbt {
  const envelope = `{"p":"cove","v":1,"op":"deploy","tick":"${p.ticker}"}`;
  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScript(envelope), valueSats: 0n },
      { script: Buffer.from(p.config.treasuryScript, "hex"), valueSats: p.config.launchFeeSats },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
  });
}

/**
 * Build an unsigned MINT PSBT. Curve + platform fee are recomputed here from
 * the canonical curve (never supplied by the caller as authoritative).
 * Layout:
 *   vout0 OP_RETURN, vout1 recipient dust, vout2 curve → reserve (EXACT),
 *   vout3 platform fee → treasury (EXACT), vout4+ change.
 */
export function buildCoveMintPsbt(p: BuildMintParams): CovePsbt {
  const quote = quoteExactTokens({
    desiredTokens: p.amountTokens,
    currentSupply: p.supplyBeforeTokens,
  });
  const curve = quote.curveContributionSats;
  const fee = computePlatformFee(curve, p.config.primaryMintFeeBps);

  const envelope = `{"p":"cove","v":1,"op":"mint","tick":"${p.ticker}","amt":"${p.amountTokens}","s":"${p.supplyBeforeTokens}"}`;

  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScript(envelope), valueSats: 0n },
      { script: Buffer.from(p.recipientScriptHex, "hex"), valueSats: RECIPIENT_DUST_SATS },
      { script: Buffer.from(p.config.reserveScript, "hex"), valueSats: curve },
      { script: Buffer.from(p.config.treasuryScript, "hex"), valueSats: fee },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
  });
}

/**
 * Build an unsigned TRANSFER PSBT. Layout:
 *   vout0 OP_RETURN, vout1 recipient dust, vout2+ change.
 */
export function buildCoveTransferPsbt(p: BuildTransferParams): CovePsbt {
  const envelope = `{"p":"cove","v":1,"op":"transfer","tick":"${p.ticker}","amt":"${p.amountTokens}"}`;
  return buildUnsignedPsbt({
    network: p.network,
    inputs: p.inputs,
    outputs: [
      { script: opReturnScript(envelope), valueSats: 0n },
      { script: Buffer.from(p.recipientScriptHex, "hex"), valueSats: RECIPIENT_DUST_SATS },
    ],
    changeAddress: p.changeAddress,
    feeRateSatVb: p.feeRateSatVb,
  });
}
