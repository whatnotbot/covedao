# Cove Phase 5.2 — Postgres Proof / CI Closure Gate — Report

**Status: P0 code fixes COMPLETE + locally verified (634 tests). The full
Postgres/Core integration matrix (reorg/restart/market-readiness) is NOT yet
proven green — the CI gate is therefore NOT closed. Mainnet: NOT READY. Phase 6
remains BLOCKED.**

## Git

- starting SHA: `83d544d7eb8f21df2e19d5273626763b1ce23d13`
- ending SHA: `580b6c0`
- commits: `1eb486e` (P0 fixes + store test expansion), `580b6c0` (lifecycle-index Postgres persistence)
- push status: pushed (`origin/main == 580b6c0`)
- working tree: clean except untracked `fr.html`

## Fixed persistence bugs (locally verified)

1. **backing blockHash** — `V3Store.backingSet()` now updates `blockHash` (+
   `stateVersion`/`policyVersion`/all mutable fields), so MINT/REDEEM upserts
   cannot retain a stale backing block hash.
2. **reorg failure atomicity** — `persistentWorker` + `reorgPersistentToTip` now
   apply each block to a **staged clone**, persist, then `adopt` only after the
   DB transaction commits. Memory can never run ahead/behind DB on failure.
3. **snapshot token isolation** — `loadCanonicalViewSnapshotFromDb` now respects
   its `tokenId` argument: cross-token backing/outpoint lookup returns `null`.
4. **snapshot isolation** — the snapshot read transaction uses
   `isolationLevel: "repeatable read"`.
5. **genesis cursor** — `quickVerify` skips the Core hash compare at the
   activation/genesis cursor (height 0); no ambiguous empty hash is compared to Core.
6. **true reindex** — `reindexDb` sets `rebuilding=true`, clears only the derived
   `cove_v3_*` projection, replays + persists every block, verifies the root, then
   sets `rebuilding=false`.

## Also done

- `quickVerify` now checks each backing outpoint via Core `getPrevout`
  (exists/unspent/value/script) + derives the V3 vault + verifies
  projection-root == cursor-root + token-UTXO structural invariants.
- `fullVerify` compares the DB projection root against an independent Bitcoin
  replay root (and both against the cursor root).
- Postgres store test expanded to **DEPLOY/MINT/TRANSFER/REDEEM** with exact
  `spentByTxid`/`spentHeight`/`spentBlockHash` + backing blockHash assertions and
  reverse rollback to the genesis cursor.
- `lifecycle-index` persists each block to Postgres when `DATABASE_URL` is set.

## NOT yet proven (requires Postgres — CI-configured, not locally run)

- persistent-lifecycle through **RE-BUY + P2P** (fixture still stops at REDEEM)
- persistent per-operation reorg matrix (DEPLOY/MINT/TRANSFER/REDEEM/RE-BUY/P2P)
- conflicting TRANSFER / REDEEM reorg
- restart-during-reorg scenarios
- market-readiness UTXO query proof
- DB-backed snapshot → real Guardian signing test
- deterministic golden root (the lifecycle fixture uses random keys, so the root
  is not stable across runs — needs deterministic fixture keys)

## Hard gate

**DO NOT START PHASE 6 until `cove-v3-indexer` CI is GREEN.** The CI workflow is
written to fail (not skip) on missing Postgres/Core/Simplicity, but the full
integration matrix above is the missing proof.

## Remaining blockers (after this gate is genuinely green)

- Phase 6 marketplace/order coordinator
- Phase 7 product API/UI
- Phase 8 production recovery/custody/mainnet operations

**Mainnet: NOT READY.**
