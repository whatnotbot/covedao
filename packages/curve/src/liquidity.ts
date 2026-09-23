import type { Atoms, BasisPoints, Sats } from "./types.js";
import { ATOMS_PER_TOKEN, GRADUATION_RESERVE_ATOMS, PRICE_UNIT_TOKENS, PUBLIC_SUPPLY_ATOMS } from "./constants.js";

/**
 * Cove V1 graduation + virtual constant-product liquidity pool.
 *
 * DETERMINISTIC SIMULATOR for mock/regtest/testing ONLY. It does not change the
 * Cove V1 DEPLOY/MINT/TRANSFER wire consensus, does not alter the frozen state
 * root, and is NOT activated on mainnet. The 160M graduation reserve is not a
 * trustless on-chain pool — it is a virtual pool seeded at graduation for
 * product/market-mechanics testing.
 *
 * Constant-product invariant: btcReserveSats × tokenReserveAtoms = k.
 * All arithmetic is BigInt; outputs use floor rounding so k never decreases
 * (it can only grow by the sub-unit remainder of a rounded-down output).
 */

export class LiquidityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LiquidityError";
    this.code = code;
  }
}

export function isLiquidityError(e: unknown): e is LiquidityError {
  return e instanceof LiquidityError;
}

export interface VirtualLiquidityPool {
  deploymentId: string;
  /** Tokens held by the pool (canonical 8-decimal atoms). */
  tokenReserveAtoms: Atoms;
  /** BTC (sats) held by the pool. */
  btcReserveSats: Sats;
  /** The pool's seed values (immutable). */
  initialTokenReserveAtoms: Atoms;
  initialBtcReserveSats: Sats;
  /** Cumulative trading activity. */
  totalBtcVolumeSats: Sats;
  totalTokenVolumeAtoms: Atoms;
  tradeCount: bigint;
}

export interface LiquidityConfig {
  /** Trading fee in basis points (default 0 in this simulator). */
  feeBps: BasisPoints;
  /** Maximum acceptable slippage in basis points (0 = none). */
  maxSlippageBps: BasisPoints;
}

export const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = {
  feeBps: 0n,
  maxSlippageBps: 0n,
};

// ── Graduation ───────────────────────────────────────────────────────────────

/** A token may graduate only once its confirmed public supply is fully minted. */
export function canGraduate(confirmedSupplyAtoms: Atoms): boolean {
  return confirmedSupplyAtoms >= PUBLIC_SUPPLY_ATOMS;
}

/**
 * Seed the virtual pool at graduation. Deterministic and idempotent in the sense
 * that callers guard creation with `canGraduate` (the pool is created exactly
 * once by the graduation step); this function always returns the same seed for
 * the same inputs.
 *
 * tokenReserveAtoms = 160,000,000 tokens (the graduation reserve, which never
 * appeared in any user's wallet before graduation).
 * btcReserveSats    = token.reserveSats (the accumulated curve reserve).
 */
export function graduatePool(
  deploymentId: string,
  reserveSats: Sats,
  confirmedSupplyAtoms: Atoms,
): VirtualLiquidityPool {
  if (!canGraduate(confirmedSupplyAtoms)) {
    throw new LiquidityError(
      "NOT_SOLD_OUT",
      `Cannot graduate: confirmed supply ${confirmedSupplyAtoms} < public supply ${PUBLIC_SUPPLY_ATOMS}.`,
    );
  }
  if (reserveSats <= 0n) {
    throw new LiquidityError("EMPTY_RESERVE", "Cannot graduate with an empty BTC reserve.");
  }
  return {
    deploymentId,
    tokenReserveAtoms: GRADUATION_RESERVE_ATOMS,
    btcReserveSats: reserveSats,
    initialTokenReserveAtoms: GRADUATION_RESERVE_ATOMS,
    initialBtcReserveSats: reserveSats,
    totalBtcVolumeSats: 0n,
    totalTokenVolumeAtoms: 0n,
    tradeCount: 0n,
  };
}

// ── AMM math ─────────────────────────────────────────────────────────────────

/** Fee deducted from an input amount (floor). feeBps=0 → amount unchanged. */
function netAfterFee(amount: bigint, feeBps: BasisPoints): bigint {
  if (feeBps === 0n) return amount;
  return (amount * (10_000n - feeBps)) / 10_000n;
}

/** Fee portion of an input amount (the part NOT credited to the pool). */
function feeOf(amount: bigint, feeBps: BasisPoints): bigint {
  if (feeBps === 0n) return 0n;
  return amount - netAfterFee(amount, feeBps);
}

/**
 * Tokens out for `netSats` in, holding `x` sats and `y` atoms:
 *   tokensOut = floor(y · netSats / (x + netSats)).
 */
export function buyOutput(x: Sats, y: Atoms, netSats: Sats): Atoms {
  if (netSats <= 0n) throw new LiquidityError("ZERO_INPUT", "Buy input must be positive.");
  if (x <= 0n || y <= 0n) throw new LiquidityError("EMPTY_RESERVE", "Pool reserves must be positive.");
  return (y * netSats) / (x + netSats);
}

/**
 * Sats out for `netTokens` in, holding `x` sats and `y` atoms:
 *   satsOut = floor(x · netTokens / (y + netTokens)).
 */
export function sellOutput(x: Sats, y: Atoms, netTokens: Atoms): Sats {
  if (netTokens <= 0n) throw new LiquidityError("ZERO_INPUT", "Sell input must be positive.");
  if (x <= 0n || y <= 0n) throw new LiquidityError("EMPTY_RESERVE", "Pool reserves must be positive.");
  return (x * netTokens) / (y + netTokens);
}

/** Spot price in sats per 1,000,000 display tokens (floor). */
export function pricePerMillionTokens(pool: VirtualLiquidityPool): Sats {
  const tokenTokens = pool.tokenReserveAtoms / ATOMS_PER_TOKEN;
  if (tokenTokens <= 0n) throw new LiquidityError("EMPTY_TOKEN_RESERVE", "Token reserve is empty.");
  return (pool.btcReserveSats * PRICE_UNIT_TOKENS) / tokenTokens;
}

/** Absolute price movement in basis points. */
export function priceImpactBps(priceBefore: Sats, priceAfter: Sats): BasisPoints {
  if (priceBefore <= 0n) return 0n;
  const diff = priceAfter >= priceBefore ? priceAfter - priceBefore : priceBefore - priceAfter;
  return (diff * 10_000n) / priceBefore;
}

/** Minimum acceptable output given maxSlippageBps (floor). */
function applySlippage(amount: bigint, maxSlippageBps: BasisPoints): bigint {
  if (maxSlippageBps === 0n) return amount;
  return (amount * (10_000n - maxSlippageBps)) / 10_000n;
}

// ── BUY quote / execute ──────────────────────────────────────────────────────

export interface BuyQuote {
  satsIn: Sats;
  feeBps: BasisPoints;
  tokensOut: Atoms;
  priceBefore: Sats;
  priceAfter: Sats;
  priceImpactBps: BasisPoints;
  minTokensOut: Atoms;
}

export function quoteBuy(pool: VirtualLiquidityPool, satsIn: Sats, config: LiquidityConfig): BuyQuote {
  if (satsIn <= 0n) throw new LiquidityError("ZERO_INPUT", "Buy input must be positive.");
  const net = netAfterFee(satsIn, config.feeBps);
  const tokensOut = buyOutput(pool.btcReserveSats, pool.tokenReserveAtoms, net);
  const priceBefore = pricePerMillionTokens(pool);
  const priceAfter = pricePerMillionTokens({
    ...pool,
    btcReserveSats: pool.btcReserveSats + net,
    tokenReserveAtoms: pool.tokenReserveAtoms - tokensOut,
  });
  return {
    satsIn,
    feeBps: config.feeBps,
    tokensOut,
    priceBefore,
    priceAfter,
    priceImpactBps: priceImpactBps(priceBefore, priceAfter),
    minTokensOut: applySlippage(tokensOut, config.maxSlippageBps),
  };
}

export interface BuyResult {
  pool: VirtualLiquidityPool;
  tokensOut: Atoms;
  feeSats: Sats;
}

export function executeBuy(pool: VirtualLiquidityPool, quote: BuyQuote): BuyResult {
  const net = netAfterFee(quote.satsIn, quote.feeBps);
  const tokensOut = buyOutput(pool.btcReserveSats, pool.tokenReserveAtoms, net);
  if (tokensOut < quote.minTokensOut) {
    throw new LiquidityError(
      "SLIPPAGE_EXCEEDED",
      `Buy output ${tokensOut} < minimum ${quote.minTokensOut} (reserves moved since quote).`,
    );
  }
  const feeSats = feeOf(quote.satsIn, quote.feeBps);
  return {
    tokensOut,
    feeSats,
    pool: {
      ...pool,
      btcReserveSats: pool.btcReserveSats + net,
      tokenReserveAtoms: pool.tokenReserveAtoms - tokensOut,
      totalBtcVolumeSats: pool.totalBtcVolumeSats + net,
      totalTokenVolumeAtoms: pool.totalTokenVolumeAtoms + tokensOut,
      tradeCount: pool.tradeCount + 1n,
    },
  };
}

// ── SELL quote / execute ─────────────────────────────────────────────────────

export interface SellQuote {
  tokensIn: Atoms;
  feeBps: BasisPoints;
  satsOut: Sats;
  priceBefore: Sats;
  priceAfter: Sats;
  priceImpactBps: BasisPoints;
  minSatsOut: Sats;
}

export function quoteSell(pool: VirtualLiquidityPool, tokensIn: Atoms, config: LiquidityConfig): SellQuote {
  if (tokensIn <= 0n) throw new LiquidityError("ZERO_INPUT", "Sell input must be positive.");
  const net = netAfterFee(tokensIn, config.feeBps);
  const satsOut = sellOutput(pool.btcReserveSats, pool.tokenReserveAtoms, net);
  const priceBefore = pricePerMillionTokens(pool);
  const priceAfter = pricePerMillionTokens({
    ...pool,
    btcReserveSats: pool.btcReserveSats - satsOut,
    tokenReserveAtoms: pool.tokenReserveAtoms + net,
  });
  return {
    tokensIn,
    feeBps: config.feeBps,
    satsOut,
    priceBefore,
    priceAfter,
    priceImpactBps: priceImpactBps(priceBefore, priceAfter),
    minSatsOut: applySlippage(satsOut, config.maxSlippageBps),
  };
}

export interface SellResult {
  pool: VirtualLiquidityPool;
  satsOut: Sats;
  feeTokens: Atoms;
}

export function executeSell(pool: VirtualLiquidityPool, quote: SellQuote): SellResult {
  const net = netAfterFee(quote.tokensIn, quote.feeBps);
  const satsOut = sellOutput(pool.btcReserveSats, pool.tokenReserveAtoms, net);
  if (satsOut < quote.minSatsOut) {
    throw new LiquidityError(
      "SLIPPAGE_EXCEEDED",
      `Sell output ${satsOut} < minimum ${quote.minSatsOut} (reserves moved since quote).`,
    );
  }
  const feeTokens = feeOf(quote.tokensIn, quote.feeBps);
  return {
    satsOut,
    feeTokens,
    pool: {
      ...pool,
      btcReserveSats: pool.btcReserveSats - satsOut,
      tokenReserveAtoms: pool.tokenReserveAtoms + net,
      totalBtcVolumeSats: pool.totalBtcVolumeSats + satsOut,
      totalTokenVolumeAtoms: pool.totalTokenVolumeAtoms + net,
      tradeCount: pool.tradeCount + 1n,
    },
  };
}

// ── Invariant helper ─────────────────────────────────────────────────────────

/** Constant-product k = btcReserveSats × tokenReserveAtoms. */
export function constantProduct(pool: VirtualLiquidityPool): bigint {
  return pool.btcReserveSats * pool.tokenReserveAtoms;
}
