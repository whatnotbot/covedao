import { eq, and, or, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@crclaunch/db";
import { ATOMS_PER_TOKEN } from "@crclaunch/curve";
import { requiredBackingSats } from "@crclaunch/cove-economics";
import { RESERVE_ANCHOR_SATS } from "@crclaunch/cove-guardian/v3";

/**
 * Phase 8 backing/supply invariant monitors (§63/§64). Any mismatch is CRITICAL
 * and must disable backing writes. These are independent of the covenant
 * validateStateV2 (which checks backing == R(supply) on hydration) — they run
 * directly against the DB + Core-adjacent projection.
 */

export interface InvariantResult {
  tokenId: string;
  ok: boolean;
  reason: string | null;
}

/** backingSats == R(issuedSupply) and btcValue == anchor + backingSats. */
export async function checkBackingInvariant(db: Database, network: string): Promise<InvariantResult[]> {
  const tokens = await db.select().from(schema.coveV3Tokens).where(and(eq(schema.coveV3Tokens.network, network), eq(schema.coveV3Tokens.canonical, true)));
  const backing = await db.select().from(schema.coveV3BackingStates).where(and(eq(schema.coveV3BackingStates.network, network), eq(schema.coveV3BackingStates.canonical, true)));
  const byToken = new Map(backing.map((b) => [b.tokenId, b]));
  const out: InvariantResult[] = [];
  for (const t of tokens) {
    const b = byToken.get(t.tokenId);
    if (!b) { out.push({ tokenId: t.tokenId, ok: false, reason: "missing backing" }); continue; }
    const supplyTokens = b.issuedSupplyAtoms / ATOMS_PER_TOKEN;
    const expected = requiredBackingSats(supplyTokens);
    if (b.backingSats !== expected) {
      out.push({ tokenId: t.tokenId, ok: false, reason: `backing ${b.backingSats} != R(${supplyTokens}) ${expected}` });
      continue;
    }
    if (b.btcValue !== RESERVE_ANCHOR_SATS + b.backingSats) {
      out.push({ tokenId: t.tokenId, ok: false, reason: `btcValue ${b.btcValue} != anchor+backing` });
      continue;
    }
    out.push({ tokenId: t.tokenId, ok: true, reason: null });
  }
  return out;
}

/** sum(unspent canonical token UTXOs) + sum(burned) == issued public supply. */
export async function checkSupplyInvariant(db: Database, network: string): Promise<InvariantResult[]> {
  const tokens = await db.select().from(schema.coveV3Tokens).where(and(eq(schema.coveV3Tokens.network, network), eq(schema.coveV3Tokens.canonical, true)));
  const backing = await db.select().from(schema.coveV3BackingStates).where(and(eq(schema.coveV3BackingStates.network, network), eq(schema.coveV3BackingStates.canonical, true)));
  const issued = new Map(backing.map((b) => [b.tokenId, b.issuedSupplyAtoms]));
  // A burned carrier is spent, but its tokens were issued and still count
  // against supply: the curve never walks back down for them.
  const rows = await db
    .select({ tokenId: schema.coveV3TokenUtxos.tokenId, sum: sql<bigint>`sum(${schema.coveV3TokenUtxos.amountAtoms})` })
    .from(schema.coveV3TokenUtxos)
    .where(and(
      eq(schema.coveV3TokenUtxos.network, network),
      eq(schema.coveV3TokenUtxos.canonical, true),
      or(isNull(schema.coveV3TokenUtxos.spentByTxid), eq(schema.coveV3TokenUtxos.burned, true)),
    ))
    .groupBy(schema.coveV3TokenUtxos.tokenId);
  const sumByToken = new Map(rows.map((r) => [r.tokenId, r.sum ?? 0n]));
  const out: InvariantResult[] = [];
  for (const t of tokens) {
    const expected = issued.get(t.tokenId) ?? 0n;
    const actual = sumByToken.get(t.tokenId) ?? 0n;
    out.push(actual === expected
      ? { tokenId: t.tokenId, ok: true, reason: null }
      : { tokenId: t.tokenId, ok: false, reason: `utxo sum ${actual} != issued ${expected}` });
  }
  return out;
}
