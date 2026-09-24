# Cove Phase 5 — Core Freeze Cleanup + Production V3 Indexer — Report

**Status: COMPLETE on regtest. Mainnet: NOT READY.**

Phase 5 closed the last Phase 4.4 integration seams (Job A) and built the
production V3-native persistent indexer (Job B). The protocol core remains
frozen — no wire V2 / CoveStateV2 / tokenId / geometric20 / V3 CMR / MAST /
Guardian-model changes were made.

---

## Git

- starting SHA: `6adf971f6fa40792d2c0471224b51ca31934d880`
- ending SHA: `c5b6a009784bc49fdbbedf4f37e0169d280e8f08`
- commits:
  - `155150f` Phase 5 Job A — broadcast binding, full final validation, redeem layout, V3 trust model, core-freeze manifest
  - `c5b6a00` production V3 indexer (parser/reducer/root + Postgres + reorg)
- push status: **NOT pushed** (local `main`; 2 commits ahead of `origin/main`)
- working tree: clean except untracked `fr.html` (untouched)

## Phase 4.4 cleanup (Job A)

- **broadcast validation binding**: `broadcastValidatedCoveTransaction` accepts ONLY
  an opaque branded `ValidatedCoveTransaction` (module-private `unique symbol` brand
  that only the final validators construct). Arbitrary raw hex is structurally
  excluded (architecture-tested). Added `validateFinalizedDeployTransaction`.
- **full-redeem change fix**: frozen layout — FULL `0 OP_RETURN,1 vault,2 payout,3 fee,4 optional BTC change`; PARTIAL `…4 token change carrier,5 optional BTC change`. Final validator distinguishes token change carrier from BTC change (tested: full no-change, full with BTC change, partial with carrier, 6-output rejected).
- **final validation completeness**: `validateFinalized{Mint,Redeem,Transfer}` re-check backing outpoint + script/value, carrier script type, fee amount + destination, fee-dust standardness, Simplicity + CMR, miner fee from resolved prevouts, no unexpected outputs.
- **TRUST_MODEL rewrite**: V3 production trust model; V1 moved to `docs/legacy/COVE_V1_TRUST_MODEL.md`.

## V3 schema (new tables, BigInt columns)

`cove_v3_blocks`, `cove_v3_tokens`, `cove_v3_backing_states`, `cove_v3_token_utxos`,
`cove_v3_events`, `cove_v3_cursor`, `cove_v3_undo` (JSON inverse ops for exact per-block rollback).

## Indexer architecture

- **block input**: `CoreRpcProvider.getBlock` (raw txs + height + parentHash, merkle-verified).
- **transaction parser**: `parseCoveTx` → `NON_COVE | INVALID | DEPLOY | MINT | TRANSFER | REDEEM` (Cove magic gate; malformed recorded INVALID, never applied).
- **validator/reducer**: `V3IndexerState.applyBlock` — DEPLOY/MINT/TRANSFER/REDEEM with exact vault/backing/fee/carrier/ownership checks; balances derived from token UTXOs only.
- **state root**: `Cove/IndexerState/v3` over canonically-sorted tokens/backing/UTXOs.
- **persistent store**: `V3Store` — one DB transaction per block (block + events + deltas + undo + cursor); cursor never advances on failure.
- **reorg engine**: `reorgToTip` — common-ancestor walk, undo-journal rollback (descending), replay (ascending). No full-DB wipe.

## Real lifecycle indexing (Bitcoin Core 28.1 regtest)

The proven Phase 4.4 lifecycle was indexed from REAL mined blocks:

- DEPLOY → supply 0, backing 0, token persisted.
- MINT 84M → supply 84,000,000,000,000 atoms, backing 49,350 (= R(84M)), 1 token UTXO.
- TRANSFER 84M → Alice UTXO spent, Bob UTXO created; backing/supply unchanged.
- REDEEM 84M → supply 0, backing 0, 0 token UTXOs.
- final state root: `2046ff7661c8788620c73b84ae3208925657ec25d92485bd9c741bc9e31eb16a`.

## Reorg

`invalidateblock` + re-mine → `reorgToTip` rolled back the orphaned block via the
undo journal and replayed the new tip. Final root after reorg == clean-replay root
(equality asserted). `ancestor=107, orphaned=[108], replayed=[108]`.

## Restart safety

- atomic per-block DB transaction (crash mid-block rolls back; cursor unchanged) — tested in the Postgres store test (skipped locally without a DB, run in CI).
- duplicate block/tx delivery is idempotent (`indexBlocks` skips same height+hash).

## Verification

- `cove:v3-verify` (quick): cursor hash matches Core + backing script/value == anchor + R(supply).
- `cove:v3-verify --full`: replay canonical chain into a clean state, compare root.
- `cove:v3-status`: Core tip, indexed tip, lag, state root, token/UTXO counts, aggregate supply/backing, health.

## Canonical Guardian view

`loadCanonicalViewSnapshot` returns an immutable in-memory `CoveCanonicalView`
(backing state/outpoint + relevant token UTXOs + cursor height/hash). `CoveCanonicalView`
now lives in `cove-covenant` (shared by Guardian + indexer). The Guardian never sees SQL.

## Read models

`balanceByScript` / `tokenHolders` / `tokenUtxosByScript` / `currentBacking` /
`tokenActivity`. Balances are `SUM(unspent token UTXOs)`; P2P is classified TRANSFER.

## Tests

- `pnpm typecheck` 0 errors · `pnpm lint` 0 errors/warnings · `pnpm build` 0 errors
- `pnpm test` → **630 passed, 1 skipped** (store test requires Postgres; runs in CI)
- `node scripts/check-dependency-graph.mjs` OK (no cycles)

## CI

- `.github/workflows/ci.yml` — typecheck/lint/test/build + dependency-graph check
- `.github/workflows/cove-v3-lifecycle.yml` — Rust-first lifecycle
- `.github/workflows/cove-v3-indexer.yml` — Postgres service + real Core + Simplicity binary → index lifecycle blocks → reorg → store test (no skip)

## Frozen protocol manifest

`packages/cove-guardian/src/frozen-protocol.test.ts` pins: wire 2, state 2, policy 3,
state domain `Cove/State/v2`, MINT CMR `0b594eb3…`, REDEEM CMR `37e681b3…`,
curve `geometric20`, public 840M, total 1B, reserve 160M, carrier 1000 sats,
anchor 10000 sats.

## Remaining blockers

- Phase 6 marketplace/order coordinator
- product API/UI
- production recovery quorum
- production key custody
- durable-before-sign audit
- mainnet fee schedule
- operational monitoring/value caps
- mainnet canary

**Mainnet: NOT READY.**
