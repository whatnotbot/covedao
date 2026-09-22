import type { Database } from "@crclaunch/db";
import { insertQuote } from "@crclaunch/db";
import {
  computePlatformFee,
  getMinimumContribution,
  quoteExactTokens,
  quoteExactSats,
  type QuoteResult,
} from "@crclaunch/curve";
import { ProtocolError } from "@crclaunch/protocol";
import type { CRCProtocolAdapter } from "@crclaunch/protocol";
import type { BitcoinProvider } from "@crclaunch/bitcoin";
import type { RuntimeConfig } from "@crclaunch/config";

export interface QuoteRequest {
  deploymentId: string;
  mode: "EXACT_TOKENS" | "EXACT_SATS";
  tokens?: string;
  sats?: string;
  walletAddress: string;
}

export interface QuoteResponse extends QuoteResult {
  quoteId: string;
  platformFeeSats: bigint;
  estimatedMinerFeeSats: bigint;
  totalEstimatedSpendSats: bigint;
  stateHash: string;
  expiresAtHeight: bigint;
  expiresAt: string;
  feeWarning: boolean;
  feeConfirmationRequired: boolean;
  feeBlocked: boolean;
}

export async function estimateMinerFee(bitcoin: BitcoinProvider): Promise<bigint> {
  const fees = await bitcoin.getFeeEstimates();
  // ~250 vbytes for a typical mint; use the half-hour rate.
  return fees.halfHourSatVb * 250n;
}

export async function computeQuote(
  db: Database,
  adapter: CRCProtocolAdapter,
  bitcoin: BitcoinProvider,
  config: RuntimeConfig,
  req: QuoteRequest,
): Promise<QuoteResponse> {
  const token = await adapter.getTokenByDeployment(req.deploymentId);
  if (!token) throw new ProtocolError("PROTOCOL_UNAVAILABLE", "Token not found.");
  if (token.status !== "LIVE") {
    throw new ProtocolError("MINT_SOLD_OUT", "Public mint is not live.");
  }

  const currentSupply = token.confirmedMintedAtoms;
  const stateHash = await adapter.getStateHash();
  const height = await adapter.getCurrentHeight();
  const minerFee = await estimateMinerFee(bitcoin);
  const minimum = getMinimumContribution(minerFee);

  let quote: QuoteResult;
  if (req.mode === "EXACT_TOKENS") {
    if (!req.tokens) throw new ProtocolError("INSUFFICIENT_BTC", "Token amount is required.");
    const desired = BigInt(req.tokens);
    if (desired <= 0n) throw new ProtocolError("INSUFFICIENT_BTC", "Token amount must be positive.");
    quote = quoteExactTokens({ desiredTokens: desired, currentSupply });
  } else {
    if (!req.sats) throw new ProtocolError("INSUFFICIENT_BTC", "Sats amount is required.");
    const sats = BigInt(req.sats);
    if (sats <= 0n) throw new ProtocolError("INSUFFICIENT_BTC", "Sats amount must be positive.");
    quote = quoteExactSats({ availableSats: sats, currentSupply });
  }

  // Minimum contribution enforcement (section 10).
  if (quote.curveContributionSats < minimum) {
    throw new ProtocolError(
      "INSUFFICIENT_BTC",
      `Minimum curve contribution is ${minimum} sats (network fee protection).`,
    );
  }

  const platformFee = computePlatformFee(quote.curveContributionSats, config.primaryMintFeeBps);
  const total = quote.curveContributionSats + platformFee + minerFee;

  const feeRatio = quote.curveContributionSats > 0n ? (minerFee * 100n) / quote.curveContributionSats : 0n;
  const feeWarning = feeRatio > 10n;
  const feeConfirmationRequired = feeRatio > 20n;
  const feeBlocked = feeRatio > 50n;

  const expiresAt = new Date(Date.now() + config.quoteTtlSeconds * 1000);
  const row = await insertQuote(db, {
    network: config.network,
    deploymentId: req.deploymentId,
    walletAddress: req.walletAddress,
    mode: req.mode,
    tokensAtoms: quote.tokens,
    curveContributionSats: quote.curveContributionSats,
    platformFeeSats: platformFee,
    estimatedMinerFeeSats: minerFee,
    totalEstimatedSpendSats: total,
    startingStage: quote.startingStage,
    endingStage: quote.endingStage,
    supplyBeforeAtoms: quote.supplyBefore,
    supplyAfterAtoms: quote.supplyAfter,
    stateHash,
    expiresAtHeight: height + BigInt(config.quoteTtlBlocks),
    expiresAt,
  });
  if (!row) throw new Error("Failed to persist quote.");

  return {
    quoteId: row.id,
    ...quote,
    platformFeeSats: platformFee,
    estimatedMinerFeeSats: minerFee,
    totalEstimatedSpendSats: total,
    stateHash,
    expiresAtHeight: height + BigInt(config.quoteTtlBlocks),
    expiresAt: expiresAt.toISOString(),
    feeWarning,
    feeConfirmationRequired,
    feeBlocked,
  };
}
