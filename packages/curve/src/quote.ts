import type { Sats, TokenAtoms } from "./types.js";
import { PRICE_UNIT_ATOMS, PUBLIC_SUPPLY_ATOMS, TOKENS_PER_STAGE } from "./constants.js";
import { CurveError, getStageForSupply, getStagePrice } from "./prices.js";
import { ceilDiv } from "./fees.js";

export interface ExactTokensInput {
  desiredTokens: TokenAtoms;
  currentSupply: TokenAtoms;
}

export interface ExactSatsInput {
  availableSats: Sats;
  currentSupply: TokenAtoms;
}

export interface QuoteResult {
  tokens: TokenAtoms;
  curveContributionSats: Sats;
  startingStage: number;
  endingStage: number;
  supplyBefore: TokenAtoms;
  supplyAfter: TokenAtoms;
}

function assertSupply(supply: TokenAtoms): void {
  if (supply < 0n) {
    throw new CurveError("NEGATIVE_SUPPLY", "Supply cannot be negative.");
  }
  if (supply >= PUBLIC_SUPPLY_ATOMS) {
    throw new CurveError("MINT_SOLD_OUT", "Public mint is sold out.");
  }
}

/**
 * EXACT_TOKENS quote. Walks stages from the current supply, computing the
 * exact integer sats cost for a desired token quantity using ceil rounding
 * per chunk. Rejects requests exceeding remaining public supply.
 */
export function quoteExactTokens(input: ExactTokensInput): QuoteResult {
  const { desiredTokens, currentSupply } = input;
  if (desiredTokens <= 0n) {
    throw new CurveError("ZERO_QUANTITY", "Desired token quantity must be positive.");
  }
  assertSupply(currentSupply);

  const remainingPublic = PUBLIC_SUPPLY_ATOMS - currentSupply;
  if (desiredTokens > remainingPublic) {
    throw new CurveError(
      "EXCEEDS_REMAINING_SUPPLY",
      `Requested ${desiredTokens} tokens but only ${remainingPublic} remain.`,
    );
  }

  const startingStage = getStageForSupply(currentSupply);
  let endingStage = startingStage;
  let supply = currentSupply;
  let remaining = desiredTokens;
  let totalSats = 0n;

  while (remaining > 0n) {
    const stage = getStageForSupply(supply);
    endingStage = stage;
    const stageEnd = BigInt(stage) * TOKENS_PER_STAGE;
    const remainingInStage = stageEnd - supply;
    const chunk = remaining < remainingInStage ? remaining : remainingInStage;
    const price = getStagePrice(stage);
    const cost = ceilDiv(chunk * price, PRICE_UNIT_ATOMS);
    totalSats += cost;
    supply += chunk;
    remaining -= chunk;
  }

  return {
    tokens: desiredTokens,
    curveContributionSats: totalSats,
    startingStage,
    endingStage,
    supplyBefore: currentSupply,
    supplyAfter: supply,
  };
}

/**
 * EXACT_SATS quote. Computes the maximum number of tokens obtainable for a
 * given curve contribution without ever overspending. Remainder stays in the
 * buyer wallet. Uses integer arithmetic only.
 */
export function quoteExactSats(input: ExactSatsInput): QuoteResult {
  const { availableSats, currentSupply } = input;
  if (availableSats <= 0n) {
    throw new CurveError("ZERO_QUANTITY", "Available sats must be positive.");
  }
  assertSupply(currentSupply);

  const startingStage = getStageForSupply(currentSupply);
  let endingStage = startingStage;
  let supply = currentSupply;
  let remainingSats = availableSats;
  let totalTokens = 0n;

  while (remainingSats > 0n && supply < PUBLIC_SUPPLY_ATOMS) {
    const stage = getStageForSupply(supply);
    endingStage = stage;
    const stageEnd = BigInt(stage) * TOKENS_PER_STAGE;
    const remainingInStage = stageEnd - supply;
    const price = getStagePrice(stage);

    // Max tokens t with ceil(t*price/1M) <= remainingSats  <=>  t*price <= remainingSats*1M.
    const maxAffordableInStage = (remainingSats * PRICE_UNIT_ATOMS) / price;
    const chunk = maxAffordableInStage < remainingInStage ? maxAffordableInStage : remainingInStage;

    const cost = ceilDiv(chunk * price, PRICE_UNIT_ATOMS);
    totalTokens += chunk;
    supply += chunk;
    remainingSats -= cost;
  }

  return {
    tokens: totalTokens,
    curveContributionSats: availableSats - remainingSats,
    startingStage,
    endingStage,
    supplyBefore: currentSupply,
    supplyAfter: supply,
  };
}
