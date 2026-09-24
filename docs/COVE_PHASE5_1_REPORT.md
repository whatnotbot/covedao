# Cove Phase 5.1 — Persistent Truth Gate — Report

**Status: code complete + locally verified (634 tests green); the Postgres
integration matrix is written + CI-configured but NOT yet confirmed green
(no local Postgres). Mainnet: NOT READY.**

The sole objective was to make Postgres + restart + reorg + verify represent
exactly the same canonical Cove V3 state as deterministic replay. No protocol
redesign was performed.

---

## Git

- starting SHA: `64505aa428670f7c8d3de708cff7e7373068c5d6`
- ending SHA: (this phase) `008922c…` + report commit
- commits: `008922c` (P0 fixes + hydration/snapshot/persistent worker/reorg/undo/health/read-models/CLI)
- working tree: clean except untracked `fr.html`

## P0 fixes (locally verified)

1. **spentByTxid** — `UndoOp` now carries an explicit `spendingTxid` for TRANSFER
   and REDEEM. The store persists `spentByTxid = actual spending txid` (never
   `null` + `spentHeight`), so spendability is never inferred from height alone.
   Full REDEEM (no created token UTXO) is correct. Rollback restores all three
   spent fields to `null`.
2. **backing blockHash** — `V3Backing.updatedBlockHash` populated on every
   DEPLOY/MINT/REDEEM transition; `backingRow()` persists the real block hash
   (no longer `""`).
3. **cursor rollback** — `V3Store.rollback(tx, undo, newCursor)` now moves the
   cursor backward to the previous canonical block (or genesis) inside the same
   transaction.

## Persistent architecture

- `undo.ts` — canonical `encodeUndo`/`decodeUndo` BigInt-safe roundtrip for every
  UndoOp kind; malformed JSON fails loudly (tested).
- `hydrate.ts` — `hydrateState` (DB → `V3IndexerState`), fail-closed on duplicate
  tokenId/outpoint, spent-loaded-as-unspent, missing backing, `R(s)` mismatch
  (via `validateStateV2`), malformed cursor; never reads V1 tables.
- `snapshot.ts` — `loadCanonicalViewSnapshotFromDb` (single Postgres transaction,
  immutable `CoveCanonicalView` with cursor/stateRoot/rebuilding).
- `health.ts` — `HEALTHY | BEHIND | REBUILDING | DIVERGED | CORE_UNREACHABLE`.
- `persistent.ts` — `persistentWorker` (cursor advances LAST; in-memory state
  reverts on DB failure so it never runs ahead) and `reorgPersistentToTip`
  (common-ancestor, per-block DB rollback descending + replay ascending).
- `read-models-db.ts` — DB adapters using ONLY `canonical=true AND spentByTxid IS NULL`.
- `cli-run.ts` — `status` / `verify [--full]` / `reindex` on Postgres
  (`DATABASE_URL` required).

## Tests

- `pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm build` 0 · `node scripts/check-dependency-graph.mjs` OK
- `pnpm test` → **634 passed, 1 skipped** (Postgres store test)
- new: `undo.test.ts` (roundtrip + malformed rejection)

## Real lifecycle indexing (in-memory, real Core regtest)

DEPLOY → MINT → TRANSFER → REDEEM indexed from real mined blocks; final root
`2046ff76…`; single-tip reorg rollback/replay root equality asserted.

## NOT yet confirmed (requires live Postgres — CI-configured, not locally run)

The following are written and wired into `.github/workflows/cove-v3-indexer.yml`
but could not be executed locally (no Postgres available):

- Postgres store test across DEPLOY/MINT/TRANSFER/REDEEM with exact spent markers
- persistent `status` / `verify` / `verify --full` / `reindex` CLI against Postgres
- full lifecycle through RE-BUY + P2P persisted to Postgres
- persistent per-operation reorg matrix (DEPLOY/MINT/TRANSFER/REDEEM/RE-BUY/P2P)
- conflicting TRANSFER / REDEEM reorg
- restart-during-reorg scenarios
- market-readiness query (seller unspent UTXO → real P2P spend → DB reflects spend)

## Hard gate

**DO NOT START PHASE 6 until `cove-v3-indexer` CI is GREEN.** A persistence bug
could otherwise permit double-listing, listing spent/orphaned inventory, or
filling from stale ownership.

## Remaining blockers

- Phase 6 marketplace/order coordinator
- Phase 7 product API + UI
- Phase 8 operational/mainnet security

**Mainnet: NOT READY.**
