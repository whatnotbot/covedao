import { createHash } from "node:crypto";
import type { CoveState } from "./types.js";

/**
 * INDEPENDENT reference implementation of the frozen Cove V1 state root
 * serialization (see docs/COVE_V1_STATE_ROOT.md).
 *
 * This file deliberately does NOT import the production serializer
 * (`state-root.ts`). It re-derives the exact byte layout from the spec so a
 * defect in one implementation cannot silently pass validation. The test suite
 * proves the two implementations agree on golden vectors.
 *
 * Layout (record delimiter ":", section delimiter "\n---\n"):
 *   domain
 *   tokens        "id:ticker:creator:confirmedSupplyAtoms:currentStage" sorted
 *   tickerIndex   "ticker:id" sorted
 *   balances      "owner:dep:availableAtoms" sorted
 *   reserveSats
 *   platformTreasurySats
 * digest = sha256(payload) hex, lowercase.
 */

const SECTION_SEP = "\n---\n";

function sortRecords(records: string[]): string[] {
  // Byte-lexicographic ordering via default string comparison (identical to
  // Array.prototype.sort with no comparator).
  return records.sort();
}

export function referenceComputeStateRoot(state: CoveState, domain: string): string {
  // Section 2 — tokens, flattened then sorted by the joined record string.
  const tokenRecords: string[] = [];
  for (const [id, token] of state.tokens) {
    tokenRecords.push(
      `${id}:${token.ticker}:${token.creator}:${token.confirmedSupplyAtoms}:${token.currentStage}`,
    );
  }
  const tokensSection = sortRecords(tokenRecords).join("\n");

  // Section 3 — ticker index.
  const tickerRecords: string[] = [];
  for (const [ticker, id] of state.tickerIndex) {
    tickerRecords.push(`${ticker}:${id}`);
  }
  const tickerSection = sortRecords(tickerRecords).join("\n");

  // Section 4 — balances, flattened across owners then deployments.
  const balanceRecords: string[] = [];
  for (const [owner, byDep] of state.balances) {
    for (const [dep, balance] of byDep) {
      balanceRecords.push(`${owner}:${dep}:${balance.availableAtoms}`);
    }
  }
  const balancesSection = sortRecords(balanceRecords).join("\n");

  // Assemble in the frozen section order.
  const payload = [
    domain,
    tokensSection,
    tickerSection,
    balancesSection,
    String(state.reserveSats),
    String(state.platformTreasurySats),
  ].join(SECTION_SEP);

  return createHash("sha256").update(payload).digest("hex");
}
