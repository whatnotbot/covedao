# Cove Phase 5.3 — Persistent Proof Closure — Final Report

**PHASE 5 PERSISTENT TRUTH GATE: CLOSED.** `cove-v3-indexer` CI is GREEN with an
actual workflow run. Mainnet: **NOT READY**. Phase 6 may now be considered.

## Git

- starting SHA: `568d416b19b7f710d567254baa08c5c492f9116b`
- ending SHA: `181b5e5afd1a9cb9a18394c4663a0a7dab0e06c9`
- push state: pushed (`origin/main == 181b5e5`)
- working tree: clean except untracked `fr.html`

## CI (actual run)

- workflow: **Cove V3 indexer — persistent truth gate**
- run ID: **35988316487**
- URL: https://github.com/whatnotbot/covedao/actions/runs/35988316487
- conclusion: **success** (all other workflows on `181b5e5` also green: CI, cove V3 full lifecycle, covenant regtest, V1 reorg, vault CSV, Simplicity differential)

## Production export hygiene

- `REGTEST_KEYS` + `*_PRIV` moved to `src/v3/testing/regtest-fixture.ts`; the
  production `@crclaunch/cove-indexer/v3` entrypoint exports none of them
  (architecture-tested via `export-hygiene.test.ts`).
- Single deterministic fixture (`regtestConfig()`) shared by lifecycle, CLI,
  replay, reindex, reorg matrix (no fee-destination drift).

## Persistent lifecycle (real Core + Postgres, all six ops persisted)

| op | txid |
|----|------|
| DEPLOY | `fe73b12781cc2e9c8cddf9100918dd11e75dc4c50aab0b2ae374326283f5a3b6` |
| MINT | `6351557961a733d05aee91ca9a67be9ee6de8246bfeb2fba3a8a6dd548ab102f` |
| TRANSFER | `aedeef997602d28731632b58ff6667c99629d0f498e17a0b023b6da1f3eb8d4a` |
| REDEEM | `a8e2ce33e03bd7173ddc1230e4686dbb47ae088a6ab23d6fa17f6eec2efdc5af` |
| RE-BUY | `ef79727f1a97444415a7de143c6dab289d2489bb6f13027ed29a3017565e84aa` |
| P2P | `d9e45a62c0a456edf1e47abd22cfd38b79b505377967ae25a4670b4110a0504e` |

After each op, the assertion authority was the hydrated Postgres projection
(not the in-memory builder state). Market-readiness: seller inventory query
(`getTokenUtxosByScriptDb`) returned the live UTXO before P2P and was absent
after (spent marker persisted). DB snapshot drove a real Guardian MINT
(Simplicity PASS, CMR `0b594eb3…`). Final persisted root:
`dc0627028a738b42b902066a04d9d301c301d648ab6ae7eb4ee4bc0fa62b8274`.

## Persistent reorg matrix (real Core + Postgres)

- TRANSFER reorg rollback → Alice inventory restored, Bob removed.
- replay → Bob re-confirmed; `X.spentByTxid == f2a07bca…`.
- restart + hydrate → DB root == clean replay root `754b3e5791e3aa05c424a2b02149d136a706cf8647436ce66463685bd7c5c9c0`.

## Reindex

- `v3:reindex` → height 115, root `754b3e5791…` (equals the pre-reindex canonical
  root — full-rebuild equality proven). `rebuilding` is true throughout and only
  cleared after `computeStateRootFromDb` + `quickVerify` + `fullVerify` pass.

## Verification

- `v3:verify` PASS, `v3:verify --full` PASS (DB projection vs independent Bitcoin
  replay).

## Tests

- Local: **642 passed, 1 skipped** (the skipped one is the Postgres store test,
  which runs — not skipped — in CI).
- Postgres CI: all-op store test executed (0 skips), golden-root (5), undo (4),
  export-hygiene (3), state (3).

## Golden state root

`bedca56f5964366bb0dd0b7c023c77d56b37d301a8799d6a98ac18b807f190f8` — unchanged;
insertion-order invariance + amount/outpoint/script mutation tests pass.

## Protocol freeze

No frozen constant changed (wire V2, CoveStateV2, policy V3, tokenId,
geometric20, V3 CMRs, V3 MAST, Guardian/Simplicity, token-UTXO semantics).

## Remaining blockers (Phase 6+)

- Phase 6 — marketplace/order coordinator
- Phase 7 — product API/UI
- Phase 8 — production recovery/custody/mainnet operations

**Mainnet: NOT READY.**
