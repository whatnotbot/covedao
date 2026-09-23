import type { Atoms, Sats } from "./types.js";
import {
  LiquidityError,
  executeBuy,
  executeSell,
  graduatePool,
  quoteBuy,
  quoteSell,
  type BuyResult,
  type LiquidityConfig,
  type SellResult,
  type VirtualLiquidityPool,
} from "./liquidity.js";

export interface SimUser {
  tokenAtoms: Atoms;
  sats: Sats;
}

/**
 * Stateful deterministic simulator for the virtual pool: tracks the pool plus
 * per-user token/sat balances, and enforces graduation idempotency and the
 * "user must own enough" checks that the pure AMM cannot see.
 */
export class LiquiditySimulator {
  pool: VirtualLiquidityPool | null = null;
  private readonly users = new Map<string, SimUser>();

  user(id: string): SimUser {
    let u = this.users.get(id);
    if (!u) {
      u = { tokenAtoms: 0n, sats: 0n };
      this.users.set(id, u);
    }
    return u;
  }

  fundSats(id: string, sats: Sats): void {
    this.user(id).sats += sats;
  }

  fundTokens(id: string, atoms: Atoms): void {
    this.user(id).tokenAtoms += atoms;
  }

  requirePool(): VirtualLiquidityPool {
    if (!this.pool) throw new LiquidityError("NOT_GRADUATED", "The pool has not been seeded (graduate first).");
    return this.pool;
  }

  /** Idempotent guard: the pool is created exactly once. */
  graduate(deploymentId: string, reserveSats: Sats, confirmedSupplyAtoms: Atoms): VirtualLiquidityPool {
    if (this.pool) {
      throw new LiquidityError("ALREADY_GRADUATED", `Pool for ${deploymentId} already exists; cannot graduate twice.`);
    }
    this.pool = graduatePool(deploymentId, reserveSats, confirmedSupplyAtoms);
    return this.pool;
  }

  buy(id: string, satsIn: Sats, config: LiquidityConfig): BuyResult {
    const user = this.user(id);
    if (user.sats < satsIn) {
      throw new LiquidityError("INSUFFICIENT_SATS", `${id} has ${user.sats} sats, needs ${satsIn}.`);
    }
    const pool = this.requirePool();
    const result = executeBuy(pool, quoteBuy(pool, satsIn, config));
    user.sats -= satsIn;
    user.tokenAtoms += result.tokensOut;
    this.pool = result.pool;
    return result;
  }

  sell(id: string, tokensIn: Atoms, config: LiquidityConfig): SellResult {
    const user = this.user(id);
    if (user.tokenAtoms < tokensIn) {
      throw new LiquidityError("INSUFFICIENT_TOKENS", `${id} has ${user.tokenAtoms} atoms, needs ${tokensIn}.`);
    }
    const pool = this.requirePool();
    const result = executeSell(pool, quoteSell(pool, tokensIn, config));
    user.tokenAtoms -= tokensIn;
    user.sats += result.satsOut;
    this.pool = result.pool;
    return result;
  }
}
