# Cove V3 — Mainnet Readiness Checklist

Phase 8A code/readiness gate. Real BTC canary is manual (§8B) and never autonomous.

## Frozen protocol (unchanged)

wire V2 · CoveStateV2 · policy V3 · tokenId · geometric20/R(s) · V3 CMRs ·
token-UTXO ownership · transfer semantics · Market Listing V1 · V3 state-root
domain. The ONE explicit versioned change is the vault recovery profile.

## Vault security profile

- `COVE_V3_VAULT_PROFILE_DEV1` — historical single-key 144-CSV (regtest/golden).
- `COVE_V3_VAULT_PROFILE_MAINNET1` — 2-of-3 threshold recovery, lexicographic key
  order, committed CSV delay. Golden vectors frozen in `cove-vault`.

## Operator decisions (OWNER_DECISION_REQUIRED until supplied)

- `activationHeight` — immutable once canary begins
- `guardianXOnly` — committed public key (custody backend selected)
- `recovery.pubkeys` (3 x-only) + `recovery.csvBlocks` + threshold=2
- `feeScript` — committed public fee destination
- `buyFeeBps` / `redeemFeeBps` / `p2pFeeBps` — approved mainnet schedule
- canary allowlist (operator wallet scripts) + caps (max backing/buy/redeem/P2P)

## Fail-closed invariants

- mainnet default = DISABLED; missing env/profile/signer/audit → OFF.
- mainnet web/worker reject local Guardian key and recovery private key env.
- `deriveMainnetStage(profile, canaryManifest, health)` is deterministic.
- env cannot redefine committed consensus/economics (profile mismatch = fatal).

## Guardian

- separate service boundary; no generic remote sign API; only
  validate-and-sign-mint / validate-and-sign-redeem.
- durable-before-sign audit (hash-chained, `Cove/GuardianAudit/v1`); audit
  failure → no signature.
- durable per-backing signing journal: conflicting digest → BACKING_ALREADY_SIGNED;
  same digest retry idempotent; survives restart.

## Recovery

- offline `cove-recovery` tool; no auto-broadcast; explicit destination/fee
  policy; threshold finalization.

## Operational

- backups/restore drill; reindex drill; runbooks; threat model; secret scan;
  release manifest; readiness CLI.

## Status

Tracked in `PHASE8_REPORT.md`. Canary proceeds only after every code/CI gate is
green and all operator decisions are supplied.
