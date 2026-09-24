# Cove Phase 5.3 — Persistent Proof Closure — Report

**Status: P0 code fixes COMPLETE + locally verified (639 tests). The full
persistent integration matrix (persistent-lifecycle through P2P, reorg matrix,
restart, failure injection, market-readiness, snapshot→Guardian) is NOT yet
implemented/run, so `cove-v3-indexer` CI is NOT green. Phase 6 remains BLOCKED.**
Per the phase's own gate, I am NOT declaring this phase complete.

## Git

- starting SHA: `568d416b19b7f710d567254baa08c5c492f9116b`
- ending SHA: `680db1c`
- commits: `680db1c`
- push status: NOT pushed (local; see below)

## Done (locally verified)

1. **Config drift fixed** — `regtest-fixture.ts` defines ONE deterministic
   REGTEST config (guardian/recovery/fee keys `0x42/0x43/0x44`, P2WPKH feeScript,
   nonce `0xab`, ticker `FROG`, `CHAIN_BITCOIN_REGTEST`). `lifecycle-index` and the
   persistent CLI now both use it — the fee destination can no longer differ
   between the lifecycle and independent replay.
2. **Deterministic test keys** — deployer/alice/bob/carol/fee are fixed
   REGTEST-ONLY private keys (`0x45…0x49`), clearly marked never-mainnet.
3. **Rebuilding flag fixed** — `V3Store.persistBlock({ rebuilding })` no longer
   autonomously sets `rebuilding=false`; `persistentWorker` threads it; `reindexDb`
   passes `rebuilding=true` for every block.
4. **Reindex verifies before healthy** — `reindexDb` now runs
   `computeStateRootFromDb` + `quickVerify` + `fullVerify` BEFORE clearing
   `rebuilding`; any failure throws and leaves `rebuilding=true`.
5. **Golden state root frozen** — `V3_STATE_ROOT_GOLDEN =
   bedca56f5964366bb0dd0b7c023c77d56b37d301a8799d6a98ac18b807f190f8` for the full
   DEPLOY→MINT→TRANSFER→REDEEM→RE-BUY→P2P fixture (fixed txids/outpoints/scripts),
   with insertion-order invariance + amount/outpoint/script mutation tests.

`pnpm typecheck`/`lint`/`build` green; `pnpm test` → **639 passed, 1 skipped**
(the skipped test is the Postgres store test, which runs in CI).

## NOT done (the gate remains open)

- `v3:persistent-lifecycle` (real Core+Postgres through RE-BUY + P2P, hydrate-from-DB as the proof authority)
- `v3:persistent-reorg-matrix` (DEPLOY/MINT/TRANSFER/REDEEM/RE-BUY/P2P + conflicting transfer/redeem)
- restart-during-reorg + DB failure-injection integration tests
- market-readiness inventory proof (`getTokenUtxosByScriptDb` before/after P2P + reorg)
- DB-backed snapshot → real Guardian signing test (+ stale/cross-token rejection)
- REPEATABLE-READ snapshot consistency test
- reindex health-semantics integration test
- CI workflow rewrite around `persistent-lifecycle` + `persistent-reorg-matrix`

These require a live Postgres (plus real Core) and are the actual "prove the
persistent projection == replay" body of this phase. I could not run them locally.

## Hard gate

**DO NOT START PHASE 6.** `cove-v3-indexer` CI must be genuinely GREEN, with the
persistent integration matrix above passing, first.

## Remaining blockers (after the gate closes)

- Phase 6 marketplace/order coordinator
- Phase 7 product API/UI
- Phase 8 production recovery/custody/mainnet operations

**Mainnet: NOT READY.**
