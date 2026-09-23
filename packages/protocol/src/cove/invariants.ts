import type { CoveState } from "./types.js";

/**
 * Conservation + well-formedness invariants for CoveState. A violation is a
 * hard throw (never a log line) — the ledger must never leave a token's total
 * minted supply differing from the sum of all balances.
 */
export function assertCoveInvariants(state: CoveState): void {
  for (const [deploymentId, token] of state.tokens) {
    if (token.confirmedSupplyAtoms < 0n || token.confirmedSupplyAtoms > token.publicSupplyAtoms) {
      throw new Error(`token ${token.ticker}: supply out of range`);
    }
    if (state.tickerIndex.get(token.ticker) !== deploymentId) {
      throw new Error(`token ${token.ticker}: ticker index mismatch`);
    }

    let sum = 0n;
    for (const balances of state.balances.values()) {
      const b = balances.get(deploymentId);
      if (!b) continue;
      if (b.availableAtoms < 0n) {
        throw new Error(`token ${token.ticker}: negative balance`);
      }
      sum += b.availableAtoms;
    }
    if (sum !== token.confirmedSupplyAtoms) {
      throw new Error(
        `token ${token.ticker}: conservation violated (Σ balances ${sum} != confirmed ${token.confirmedSupplyAtoms})`,
      );
    }
  }
}
