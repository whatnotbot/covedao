# Phase 8.1 — Mainnet Runtime Wiring Closure Report

## Git

- Starting SHA: `c8932041a1215ec1149bbb9bcc93ed1771b499db`
- Ending SHA: `b80c837`
- 16 commits on `main`, pushed to `origin/main`.
- Working tree clean except untracked `fr.html`.

## Canonical profile (ONE schema)

- `@crclaunch/cove-mainnet`: `MainnetProfile` (nested `recovery` + `canary`), one
  parser (`parseMainnetProfileJson`), one validator (`validateMainnetProfile`),
  one canonical hash (`Cove/MainnetProfile/v1`, endian-frozen, lexicographic
  pubkey sorting).
- Template: `config/cove-v3-mainnet-profile.template.json` (all owner decisions
  null; does NOT pass readiness).
- Test-only fixture: `test/fixtures/mainnet-profile.json` (deterministic PUBLIC
  keys; validates STATIC_PROFILE_READY, hash `2a7e8211…`).
- Protocol-match validation: carrier/anchor/supply/reserve/CMRs/policy version
  must equal the frozen code constants (`PROFILE_PROTOCOL_MISMATCH` on drift).

## Mainnet runtime

| Component | Wiring |
|---|---|
| App | `loadV3AppConfig` mainnet branch (public profile only, local keys fatal), `canaryAllowed*`, `p2pFeeBps`, `activationHeight` |
| Indexer | `V3IndexerConfig.recoveryProfile` (MAINNET1), `genesisHeight` (activation), `applyBlock` ignores ops below H |
| Market | `mainnetMarketConfig(profile)` — profile p2pFeeBps + feeScript + P2P cap (no `COVE_FEE_CONFIG` leak) |
| Worker | passes `recoveryProfile` + `activationHeight` into the indexer config |
| Guardian | standalone `apps/guardian` (Node http), health + sign endpoints only |
| Core A/B | two `CoreRpcProvider`s + `checkCoreAgreement` |

## Guardian service

- Endpoints: `GET /health`, `POST /sign` (MINT/REDEEM only); bearer-token auth;
  no generic sign endpoint.
- Custody boundary: `GuardianCustodyBackend` (`xOnlyPubkey` + `signTaprootScriptPath`,
  **no exportPrivateKey**); `TestGuardianCustodyBackend` (tests) +
  `UnconfiguredGuardianCustodyBackend` (`CUSTODY_BACKEND_NOT_CONFIGURED`).
- `RemoteGuardianTransitionSigner` (functional): auth + timeout + typed parse +
  profile-hash verify (`GUARDIAN_PROFILE_MISMATCH`) + x-only key verify
  (`GUARDIAN_KEY_MISMATCH`) + independent signature re-verification
  (`SIGNATURE_VERIFICATION_FAILED`); no local fallback.

## Double-sign / audit

- Durable before-sign audit (`writeBeforeSign` → `AUDIT_PERSISTENCE_FAILED`, no
  signature) + per-backing signing journal (`InMemorySigningJournal` +
  `PostgresSigningJournal` unique outpoint).
- 20-concurrent distinct-digest race → exactly 1 RESERVED + 19 CONFLICT
  (`journal.test.ts`, `journal-audit.integration.test.ts` against Postgres).
- Post-sign audit failure (§34): no longer swallowed — surfaced as
  `SIGNED_BUT_AUDIT_FINALIZATION_FAILED`, journal reservation is NEVER released,
  a conflicting digest remains CONFLICT (test green).
- Spoofed service signature is independently rejected (`guardianApi.test.ts`).

## Core quorum

- `checkCoreAgreement`: same chain + height tolerance + identical hash at
  `min(height)`; `verifyMainnetGenesis` checks the pinned mainnet genesis.
- `deriveMainnetStage` requires `secondaryCoreHealthy` + `coreAgreement` +
  `guardianProfileHashMatches` + `guardianKeyMatches` (§28/§32/§33).
- `V3AppService.requireHealthy` fails closed (`CORE_UNAVAILABLE`) when the two
  Cores disagree (§38).

## Activation height

- Threaded `activationHeight` through app config → worker → indexer config.
- `V3IndexerState.applyBlock` ignores Cove ops below the activation height
  (test: height H-1 ignored, height H indexed).

## Canary controls

- Token allowlist (signer `allowedTokenIds` + app `CANARY_TOKEN_NOT_ALLOWED`).
- Wallet allowlist (app `CANARY_WALLET_NOT_ALLOWED` at DEPLOY/MINT/REDEEM).
- Backing/buy/redeem caps (signer `GuardianRiskPolicy`).
- P2P cap (`MarketConfig.maxP2pSettlementSats` → `P2P_SETTLEMENT_CAP_EXCEEDED`).

## Readiness aggregator + CLI

- ONE `computeMainnetReadiness()` (co-app) → stage + sub-results +
  `mutationsEnabled`; `deriveReadinessState()` maps to NOT_READY /
  READY_EXCEPT_FOR_OPERATOR_CEREMONY / READY_FOR_CONTROLLED_MAINNET_CANARY.
- CLI `pnpm cove:v3-mainnet-readiness [--static|--runtime]` consumes the SAME
  parser/validator + aggregator.

## Production-profile-regtest (verified locally, real bitcoind)

`v3-production-profile-lifecycle.ts`: DEPLOY → MINT → TRANSFER → REDEEM →
RE-BUY → P2P, with backing transitions (MINT/REDEEM/RE-BUY) travelling app →
`RemoteGuardianTransitionSigner` → in-process Guardian transport → durable audit
→ signing journal → custody backend → signature → independent client verify →
app. **PASSED** (token `4710488a…` matches the fixture canary token lock).

## Readiness fixture outputs (verified locally)

- Fixture + Core A/B + fixture Guardian: `READY_FOR_CONTROLLED_MAINNET_CANARY`
  (stage CANARY_READY).
- Real public template: `READY_EXCEPT_FOR_OPERATOR_CEREMONY` (14 owner decisions).

## CI

- `.github/workflows/cove-v3-mainnet-readiness.yml` upgraded to: build Simplicity
  + verify CMRs, start Core (regtest), run production-profile-regtest lifecycle,
  and execute the readiness CLI (static template + runtime fixture) with grep
  assertions on the two final states. No mainnet RPC, no broadcast.
- **GREEN** on `b80c837`:
  - `Cove V3 — mainnet readiness gate` run `36053793994`: success (Simplicity
    build + CMRs, recovery matrix, production-profile lifecycle through the
    remote Guardian, readiness `--static` → `READY_EXCEPT_FOR_OPERATOR_CEREMONY`,
    readiness `--runtime` → `READY_FOR_CONTROLLED_MAINNET_CANARY`, build).
  - All other workflows green on the same commit: CI (`36053794000`), V3 indexer,
    V3 product, V3 full lifecycle, V3 P2P marketplace, Simplicity, covenant,
    NUMS/vault, V1 reorg.

## Final claim

ALL CODE-SIDE MAINNET RUNTIME GATES ARE CLOSED (canonical profile + real Guardian
service + functional remote client + mainnet network/config/activation wiring +
Core quorum + readiness aggregator/CLI + canary enforcement + remote-Guardian
production-profile lifecycle), and the mainnet readiness gate CI is GREEN.
**OPERATOR CEREMONY IS NOW THE SOLE REMAINING GATE** — the only outstanding work
is the human generation/commit of the public mainnet profile values.

## Mainnet broadcast

**NONE** (regtest only; no mainnet RPC, no mainnet wallet funding, no mainnet
transaction build/sign/broadcast).
