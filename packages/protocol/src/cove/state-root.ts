import { createHash } from "node:crypto";
import type { CoveState } from "./types.js";

/**
 * Deterministic Cove state root. Includes all consensus state, canonically
 * sorted. No timestamps, DB IDs, insertion order, API metadata, or display
 * addresses.
 *
 * Included: protocol id/version, deployments (id, ticker, creator, confirmed
 * supply atoms, stage), ticker→deployment mapping, all balances
 * (available + locked atoms), reserve sats, platform treasury sats.
 */
export function computeStateRoot(state: CoveState): string {
  const tokens = [...state.tokens.entries()]
    .map(([id, t]) => `${id}:${t.ticker}:${t.creator}:${t.confirmedSupplyAtoms}:${t.currentStage}`)
    .sort()
    .join("\n");
  const tickerIndex = [...state.tickerIndex.entries()]
    .map(([tick, id]) => `${tick}:${id}`)
    .sort()
    .join("\n");
  const balances = [...state.balances.entries()]
    .flatMap(([owner, m]) =>
      [...m.entries()].map(([dep, b]) => `${owner}:${dep}:${b.availableAtoms}:${b.lockedAtoms}`),
    )
    .sort()
    .join("\n");
  const payload = [
    "cove:1:signet",
    tokens,
    tickerIndex,
    balances,
    state.reserveSats.toString(),
    state.platformTreasurySats.toString(),
  ].join("\n---\n");
  return createHash("sha256").update(payload).digest("hex");
}
