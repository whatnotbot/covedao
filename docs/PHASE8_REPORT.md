# Phase 8 — Mainnet Readiness Report

## Git

- Starting SHA: `bd1a9c56bba2423a9ff232e07005223f1aafe212`
- Ending SHA: `c786621`
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

- `Cove V3 — mainnet readiness gate` run **36018880603**: success (protocol
  freeze, vault profile goldens, fail-closed config, secret scan, full build).
- All prior workflows green on the same commit: CI, V3 indexer, V3 market,
  V3 full lifecycle, V3 product, covenant, NUMS/vault, Simplicity, V1 reorg.

## Owner decisions remaining

activationHeight, guardianXOnly (custody backend), recovery.pubkeys/csvBlocks,
feeScript, buy/redeem/p2pFeeBps, canary allowlist + caps.

## Honest status — NOT_READY for canary

Phase 8A code readiness is **NOT complete**. The following remain as code/tooling
(not owner ceremony) blockers, and this report must not be read as
READY_FOR_CONTROLLED_MAINNET_CANARY:

1. **Durable-before-sign Guardian audit + hash chain** and the **per-backing
   signing journal** (double-sign protection) — not implemented.
2. **Offline `cove-recovery` tool** — only the threshold leaf + witness builder
   exist; the tool and the real Core recovery consensus matrix are not built.
3. **Separate Guardian service boundary** (remote `GuardianTransitionSigner`,
   no local key on mainnet web/worker) — not implemented; only the fail-closed
   config guard exists.
4. Risk-policy caps enforced at the signer, backup/restore + reindex drills,
   monitoring/alerts, rate limits, release manifest, full runbook suite.

Final readiness: **NOT_READY**.
