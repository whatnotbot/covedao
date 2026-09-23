import { createHash } from "node:crypto";
import type { CoveState } from "./types.js";

/**
 * Deterministic Cove state root. Includes only protocol-material data
 * (deployments, ticker mapping, confirmed supplies, balances) sorted
 * canonically. No timestamps, DB UUIDs, insertion order, or metadata.
 */
export function computeStateRoot(state: CoveState): string {
  const tokens = [...state.tokens.entries()]
    .map(([id, t]) => `${id}:${t.ticker}:${t.creator}:${t.confirmedSupply}:${t.currentStage}`)
    .sort()
    .join("\n");
  const balances = [...state.balances.entries()]
    .flatMap(([owner, m]) =>
      [...m.entries()].map(([dep, b]) => `${owner}:${dep}:${b.available}:${b.locked}`),
    )
    .sort()
    .join("\n");
  const payload = [
    tokens,
    balances,
    state.reserveSats.toString(),
    state.platformTreasurySats.toString(),
  ].join("\n---\n");
  return createHash("sha256").update(payload).digest("hex");
}
