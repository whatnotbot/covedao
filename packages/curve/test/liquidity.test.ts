import { describe, expect, it } from "vitest";
import {
  ATOMS_PER_TOKEN,
  GRADUATION_RESERVE_ATOMS,
  PUBLIC_SUPPLY_ATOMS,
  getStagePrice,
  getTheoreticalFullRaise,
} from "../src/index.js";
import {
  DEFAULT_LIQUIDITY_CONFIG,
  LiquidityError,
  buyOutput,
  constantProduct,
  executeBuy,
  executeSell,
  graduatePool,
  isLiquidityError,
  priceImpactBps,
  pricePerMillionTokens,
  quoteBuy,
  quoteSell,
  sellOutput,
} from "../src/liquidity.js";
import { LiquiditySimulator } from "../src/liquidity-sim.js";

const FULL_RAISE = getTheoreticalFullRaise();
const DEPLOYMENT = "f".repeat(64);
const CFG = DEFAULT_LIQUIDITY_CONFIG;

describe("graduation", () => {
  it("cannot graduate before 840M public supply", () => {
    expect(() => graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS - 1n)).toThrow(LiquidityError);
  });

  it("can graduate exactly at 840M public supply", () => {
    expect(() => graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS)).not.toThrow();
  });

  it("seeds exactly 160M tokens (graduation reserve)", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    expect(pool.tokenReserveAtoms).toBe(GRADUATION_RESERVE_ATOMS);
    expect(pool.tokenReserveAtoms).toBe(160_000_000n * ATOMS_PER_TOKEN);
  });

  it("seeds exactly the accumulated curve reserve sats", () => {
    expect(FULL_RAISE).toBe(24_196_788n);
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    expect(pool.btcReserveSats).toBe(FULL_RAISE);
    expect(pool.initialBtcReserveSats).toBe(FULL_RAISE);
    expect(pool.initialTokenReserveAtoms).toBe(GRADUATION_RESERVE_ATOMS);
  });

  it("cannot graduate twice (simulator idempotency guard)", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    expect(() => sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS)).toThrow(/cannot graduate twice/);
  });

  it("initial pool price is continuous with the final curve stage (149,731 sats/1M)", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const price = pricePerMillionTokens(pool);
    const finalStage = getStagePrice(20);
    expect(finalStage).toBe(149_731n);
    // ~151,230 sats/1M: the handoff is close (no cliff).
    expect(price).toBeGreaterThanOrEqual(finalStage);
    expect(price - finalStage).toBeLessThan(2_000n); // under ~1% above final stage
  });

  it("rejects an empty BTC reserve at graduation", () => {
    expect(() => graduatePool(DEPLOYMENT, 0n, PUBLIC_SUPPLY_ATOMS)).toThrow(/empty BTC reserve/);
  });

  it("isLiquidityError distinguishes LiquidityError from other errors", () => {
    expect(isLiquidityError(new LiquidityError("X", "y"))).toBe(true);
    expect(isLiquidityError(new Error("plain"))).toBe(false);
  });
});

describe("constant-product AMM", () => {
  it("BUY moves token reserve down and BTC reserve up", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const before = sim.requirePool();
    sim.fundSats("alice", 1_000_000n);
    const r = sim.buy("alice", 10_000n, CFG);
    expect(r.pool.btcReserveSats).toBeGreaterThan(before.btcReserveSats);
    expect(r.pool.tokenReserveAtoms).toBeLessThan(before.tokenReserveAtoms);
  });

  it("SELL moves token reserve up and BTC reserve down", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    sim.fundTokens("alice", 100n * ATOMS_PER_TOKEN); // Alice holds 100 tokens
    const before = sim.requirePool();
    const r = sim.sell("alice", 10n * ATOMS_PER_TOKEN, CFG);
    expect(r.pool.tokenReserveAtoms).toBeGreaterThan(before.tokenReserveAtoms);
    expect(r.pool.btcReserveSats).toBeLessThan(before.btcReserveSats);
  });

  it("k does not decrease with zero fees (integer rounding only grows it)", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const k0 = constantProduct(sim.requirePool());
    sim.fundSats("a", 1_000_000n);
    sim.buy("a", 10_000n, CFG);
    sim.buy("a", 25_000n, CFG);
    sim.sell("a", sim.user("a").tokenAtoms / 2n, CFG);
    expect(constantProduct(sim.requirePool())).toBeGreaterThanOrEqual(k0);
  });

  it("pool never goes negative (huge buy cannot drain tokens below zero)", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const q = quoteBuy(pool, FULL_RAISE * 100n, CFG); // enormous buy
    expect(q.tokensOut).toBeLessThanOrEqual(pool.tokenReserveAtoms);
    const r = executeBuy(pool, q);
    expect(r.pool.tokenReserveAtoms).toBeGreaterThanOrEqual(0n);
    expect(r.pool.btcReserveSats).toBeGreaterThanOrEqual(0n);
  });

  it("zero trades are rejected", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    expect(() => quoteBuy(pool, 0n, CFG)).toThrow(/must be positive/);
    expect(() => quoteSell(pool, 0n, CFG)).toThrow(/must be positive/);
  });
});

describe("user balances", () => {
  it("update correctly across buy and sell", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    sim.fundSats("alice", 1_000_000n);
    const buy = sim.buy("alice", 10_000n, CFG);
    expect(sim.user("alice").sats).toBe(1_000_000n - 10_000n);
    expect(sim.user("alice").tokenAtoms).toBe(buy.tokensOut);

    const sell = sim.sell("alice", buy.tokensOut, CFG);
    expect(sim.user("alice").tokenAtoms).toBe(0n);
    expect(sim.user("alice").sats).toBe(1_000_000n - 10_000n + sell.satsOut);
  });

  it("rejects an insufficient token sell", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    sim.fundTokens("alice", 5n * ATOMS_PER_TOKEN);
    expect(() => sim.sell("alice", 10n * ATOMS_PER_TOKEN, CFG)).toThrow(/needs/);
  });
});

describe("slippage", () => {
  it("protects a buyer when reserves moved since the quote", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const poolA = sim.requirePool();
    const quote = quoteBuy(poolA, 10_000n, { feeBps: 0n, maxSlippageBps: 100n }); // 1% slippage

    // Another large trade moves the price up before Alice executes.
    sim.fundSats("bob", FULL_RAISE);
    sim.buy("bob", FULL_RAISE / 2n, CFG);

    expect(() => executeBuy(sim.requirePool(), quote)).toThrow(/minimum/);
  });

  it("passes when the quote and execution reserves match", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const quote = quoteBuy(sim.requirePool(), 10_000n, { feeBps: 0n, maxSlippageBps: 100n });
    expect(() => executeBuy(sim.requirePool(), quote)).not.toThrow();
  });

  it("protects a seller when reserves moved since the quote", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    sim.fundTokens("alice", 1_000_000n * ATOMS_PER_TOKEN);
    sim.fundTokens("bob", 10_000_000n * ATOMS_PER_TOKEN);
    const poolA = sim.requirePool();
    const quote = quoteSell(poolA, 100n * ATOMS_PER_TOKEN, { feeBps: 0n, maxSlippageBps: 100n });

    // A large sell (~6% of reserve) moves the price down beyond 1% before Alice executes.
    sim.sell("bob", 10_000_000n * ATOMS_PER_TOKEN, CFG);

    expect(() => executeSell(sim.requirePool(), quote)).toThrow(/minimum/);
  });
});

describe("fees", () => {
  it("a non-zero fee reduces the credited input and is reported", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const cfg = { feeBps: 100n, maxSlippageBps: 0n }; // 1% fee
    const free = quoteBuy(pool, 100_000n, CFG);
    const withFee = quoteBuy(pool, 100_000n, cfg);
    expect(withFee.tokensOut).toBeLessThan(free.tokensOut);

    const r = executeBuy(pool, withFee);
    expect(r.feeSats).toBeGreaterThan(0n);
    // Fee is deducted from input: only the net amount reaches the pool.
    expect(r.pool.btcReserveSats).toBe(pool.btcReserveSats + (100_000n - r.feeSats));
  });
});

describe("insufficient funds", () => {
  it("rejects a buy when the user lacks sats", () => {
    const sim = new LiquiditySimulator();
    sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    expect(() => sim.buy("alice", 10_000n, CFG)).toThrow(/has 0 sats/);
  });

  it("rejects a trade before the pool is graduated", () => {
    const sim = new LiquiditySimulator();
    sim.fundSats("alice", 10_000n);
    expect(() => sim.buy("alice", 10_000n, CFG)).toThrow(/not been seeded/);
  });
});

describe("determinism", () => {
  it("quote and execution are deterministic", () => {
    const pool = graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
    const q1 = quoteBuy(pool, 10_000n, CFG);
    const q2 = quoteBuy(pool, 10_000n, CFG);
    expect(q1).toEqual(q2);
    expect(executeBuy(pool, q1)).toEqual(executeBuy(pool, q2));
  });

  it("replay produces identical pool state", () => {
    function run() {
      const sim = new LiquiditySimulator();
      sim.graduate(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS);
      sim.fundSats("alice", 1_000_000n);
      sim.fundSats("bob", 1_000_000n);
      sim.buy("alice", 10_000n, CFG);
      sim.buy("bob", 25_000n, CFG);
      sim.sell("alice", sim.user("alice").tokenAtoms / 2n, CFG);
      return sim.requirePool();
    }
    expect(run()).toEqual(run());
  });
});

describe("defensive branches", () => {
  it("rejects buy/sell against empty reserves", () => {
    expect(() => buyOutput(0n, 100n, 10n)).toThrow(/reserves must be positive/);
    expect(() => buyOutput(100n, 0n, 10n)).toThrow(/reserves must be positive/);
    expect(() => sellOutput(0n, 100n, 10n)).toThrow(/reserves must be positive/);
    expect(() => sellOutput(100n, 0n, 10n)).toThrow(/reserves must be positive/);
  });

  it("rejects the price of an empty token reserve", () => {
    const pool = { ...graduatePool(DEPLOYMENT, FULL_RAISE, PUBLIC_SUPPLY_ATOMS), tokenReserveAtoms: 0n };
    expect(() => pricePerMillionTokens(pool)).toThrow(/empty/);
  });

  it("price impact of a zero before-price is zero", () => {
    expect(priceImpactBps(0n, 100n)).toBe(0n);
  });
});
