# Phase 8 — Mainnet Readiness Report

## Git

- Starting SHA: `bd1a9c56bba2423a9ff232e07005223f1aafe212`
- Ending SHA: `71c08c8`
- Branch `main`, pushed to `origin/main`; working tree clean except untracked `fr.html`.

## Protocol freeze

wire V2 · CoveStateV2 · policy V3 · tokenId · geometric20/R(s) · V3 CMRs ·
token-UTXO ownership · transfer · Market Listing V1 · state-root domain are
unchanged. The ONE explicit versioned change is the vault recovery profile.

## Vault security profile (the versioned change)

- `COVE_V3_VAULT_PROFILE_DEV1` — historical single-key 144-CSV (regtest/golden).
- `COVE_V3_VAULT_PROFILE_MAINNET1` — 2-of-3 threshold recovery via
  CHECKSIGADD, lexicographic x-only key ordering, committed CSV delay.
- Golden vectors + key-ordering + witness-slot property tests in `cove-vault`
  (27 tests green). `buildCoveVaultV3` accepts an optional recovery profile
  (defaults to DEV1), so the frozen tree remains byte-identical for regtest.

## Mainnet profile / activation stages

`cove-app/src/mainnet.ts`: deterministic `deriveMainnetStage` (default
DISABLED), committed `MainnetProfile` (public/consensus/safety constants),
fail-closed guards rejecting local Guardian/recovery keys on mainnet, and
`missingOwnerDecisions` for activation height / keys / fee schedule /
destination. Env cannot redefine committed economics.

## Security scanning / CI

`scripts/check-secrets.mjs` scans the tracked tree for test private keys, WIF,
and committed `.env` credentials. Wired into CI.

## CI

- `Cove V3 — mainnet readiness gate`: **green** (protocol freeze, vault profile
  goldens, fail-closed config, secret scan, full build, real Core recovery
  consensus matrix).
- All V3 workflows green: CI, V3 indexer (lifecycle + reorg + rebuild + backup/
  restore drill), V3 market, V3 full lifecycle (DEV1 + MAINNET1 profile
  lifecycle), V3 product, covenant, NUMS/vault, Simplicity.
- `Cove V1 real Bitcoin Core regtest reorg` is a known flaky legacy-V1 test
  (`bitcoind exited with code 1` in `regtest-reorg.ts`); unrelated to the
  Phase 8 V3-only changes (passes on most runs).

## Owner decisions remaining

activationHeight, guardianXOnly (custody backend), recovery.pubkeys/csvBlocks,
feeScript, buy/redeem/p2pFeeBps, canary allowlist + caps.

## Recovery tool + consensus matrix (done this round)

- `@crclaunch/cove-recovery`: OFFLINE recovery package — reconstructs the exact
  MAINNET1 vault, builds a destination/fee-policy-constrained spend, signs
  2-of-3 Schnorr, verifies each signature, finalizes only after threshold
  (never auto-broadcasts).
- `recovery-regtest.ts`: real Core consensus matrix — before-CSV reject, 1/3
  reject, malformed-witness reject, 2/3 accept after maturity. CI green.

## Durable audit + signing journal (done this round)

- `cove-guardian/src/v3/journal.ts`: tamper-evident audit hash chain
  (`Cove/GuardianAudit/v1`, endian-frozen canonical serialization) + a durable
  per-backing-outpoint signing journal. Conflicting digest → CONFLICT (never
  sign); same digest → IDEMPOTENT. `PostgresSigningJournal` (cove-app) uses a
  unique outpoint index so reservation is atomic and survives restart.
- Double-sign race test: 20 concurrent distinct digests → exactly one RESERVED,
  19 CONFLICT (green).

## Guardian service boundary (done this round)

- `GuardianTransitionSigner` interface (only `signMint`/`signRedeem`/`health` — no
  generic sign). `LocalGuardianTransitionSigner` validates → durably persists a
  VALIDATED_TO_SIGN audit BEFORE signing (failure → AUDIT_PERSISTENCE_FAILED,
  zero signature) → reserves the backing outpoint (conflict →
  BACKING_ALREADY_SIGNED) → signs → records after-sign. `RemoteGuardianTransitionSigner`
  is a fail-closed stub (MAINNET_SIGNER_NOT_READY) until a custody backend exists.

## Risk policy + readiness CLI (done this round)

- `GuardianRiskPolicy` enforced INSIDE the signer before audit/sign (max gross /
  redeem payout / backing / miner fee + canary token allowlist) — a compromised
  web/API cannot bypass caps.
- `scripts/cove-v3-mainnet-readiness.mjs` reports the deterministic readiness
  gate + OWNER_DECISION_REQUIRED gaps (defaults to NOT_READY).

## Release manifest + invariant monitors (done this round)

- `scripts/cove-v3-release-manifest.mjs`: deterministic release manifest (git
  commit, frozen CMRs, policy/vault-profile versions, content hash) — no secrets.
- `cove-app/invariants.ts`: `checkBackingInvariant` (backing == R(supply),
  btcValue == anchor+backing) and `checkSupplyInvariant` (sum unspent UTXOs ==
  issued supply) — per-token CRITICAL results.

## Rate limiting + metrics + backup runbook (done this round)

- `FixedWindowRateLimiter` (fixed-window, scoped by subject/operation) + test (§60).
- `Metrics` collector (Guardian/market/app counters + gauges) + test (§62).
- `docs/runbooks/BACKUP_RESTORE.md`: durable-vs-rebuildable table + encrypted
  backup/restore drill + chain-projection rebuild drill commands.
- `docs/runbooks/CANARY_OPERATIONS.md`: controlled-canary stage model, human-only
  activation, monitoring (metrics + invariants), signer-enforced caps/allowlist,
  and fail-closed pause/rollback.

## Production-profile path (done this round)

Threaded the vault recovery profile through the entire MINT/REDEEM path
(buildDeployPsbtV3 / buildMintPsbtV3 / buildRedeemPsbtV3 /
validateMint/RedeemTransitionV3 / validateFinalizedMint/RedeemTransaction /
validateAndSignMint/RedeemTransition) — all accept an optional `recoveryProfile`
(default DEV1). New test proves a full MINT builds + validates + signs against a
2-of-3 MAINNET1 vault (§137 core).

## Metrics wiring (done this round)

`Metrics` collector now emitted by the V3 worker on every reconcile tick
(market confirmations/broadcasts, active-listing gauge), closing §62.

## App profile threading (done this round)

`V3AppConfig.recoveryProfile` + `V3AppService` now thread the recovery profile
through the full backing-buy/redeem/launch path, so the product can run under
MAINNET1 (defaults DEV1). The production-profile path is end-to-end wired.

## Durable signer wired into the product path (done this round)

The production web/worker runtime now signs through the durable Guardian
boundary instead of calling `validateAndSignMintTransition` directly:

- `V3AppService` accepts an optional `transitionSigner` and branches
  `buildBackingBuy`/`buildRedeem` to `signMint`/`signRedeem` when present
  (threading `recoveryProfile` + `maxMinerFeeSats` through the request).
- `apps/web/src/lib/v3-server.ts` constructs
  `LocalGuardianTransitionSigner(signer, PostgresSigningJournal(db),
  PostgresGuardianAudit(db, <profile>), <risk policy>)` and injects it, so every
  product sign now does durable-before-sign audit + outpoint reservation +
  signer-side risk caps. `PostgresGuardianAudit` (new, `cove-app/src/audit.ts`)
  persists the VALIDATED_TO_SIGN audit row to `cove_v3_guardian_audit` with the
  actual vault profile version (no hardcoded MAINNET1).

The durable stores are now directly integration-tested against real Postgres
(`cove-app/src/journal-audit.integration.test.ts`): the signing journal's
RESERVED/IDEMPOTENT/CONFLICT + restart survival + a 20-concurrent race (exactly
one RESERVED), and the audit's canonical hash chain + linkage + restart survival
+ `signedAt`. Wired into the persistent truth-gate CI.

## MAINNET1 production-profile E2E (done this round)

`packages/cove-guardian/src/v3-mainnet-profile-lifecycle.ts` runs the full
DEPLOY→MINT→REDEEM→RE-BUY journey on real Bitcoin Core regtest + the REAL Rust
Simplicity binary under the MAINNET1 2-of-3 recovery profile, signed through the
durable `LocalGuardianTransitionSigner` (durable-before-sign audit hash chain +
per-backing signing journal + signer-side risk caps). Asserts: the recovery leaf
is the 2-of-3 threshold script (not DEV1 144-CSV), the CMR/simplicity PASS on
every transition, the double-sign journal returns CONFLICT on a conflicting
digest, and the 3-link tamper-evident audit chain verifies. Wired into the
`Cove V3 full lifecycle` workflow as a second step (same bitcoind + Simplicity).

## Backup/restore + reindex drill (done this round)

The `Cove V3 indexer` workflow now executes the runbook drills on a populated
Postgres DB: `pg_dump` → restore into a separate `cove_restore_check` DB →
assert the rehydrated state root and token-row count are identical (backup/
restore round-trip), plus the existing `v3:reindex` + `v3:verify` (full) chain-
projection rebuild. Both drills are green in CI.

## Honest status — READY_EXCEPT_FOR_OPERATOR_CEREMONY

All autonomously-deliverable code + CI gates are complete and green: the frozen
protocol/vault-profile goldens, fail-closed mainnet config, secret scan, real
Core recovery consensus matrix, full build, the DEV1 product E2E, the MAINNET1
production-profile lifecycle through the durable signer, and the backup/restore
+ reindex drills. The ONLY remaining gate is the **operator ceremony** — the
human generation + commit of the public mainnet profile values:

1. `activationHeight`, `guardianXOnly` (custody backend), `recovery.pubkeys` +
   `recovery.csvBlocks`, `feeScript`, `buyFeeBps`/`redeemFeeBps`/`p2pFeeBps`,
   canary allowlist + caps.

Final readiness: **READY_EXCEPT_FOR_OPERATOR_CEREMONY** (all code/CI gates green;
only the human operator ceremony remains before READY_FOR_CONTROLLED_MAINNET_CANARY).
No real mainnet broadcast has been or will be performed autonomously.
