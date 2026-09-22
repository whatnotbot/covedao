# Runbook

## Indexer stopped

1. Check worker logs (`pnpm --filter @crclaunch/worker dev` / `pnpm --filter @crclaunch/worker start`).
2. Restart the worker. It resumes from `indexer_cursors` and replays safely
   (idempotent upserts).
3. If the DB projection is suspect, run a full reindex: `pnpm reindex`.

## Database failure

- Projections are reproducible from chain state — a total DB loss does **not**
  imply loss of user funds.
- Restore from backup (daily snapshot / PITR if available), or recreate the
  schema with `pnpm db:migrate` and run `pnpm reindex`.

## Redis failure

- Redis backs cache + queue + mock-chain state (mock mode) and rate limits.
- Read endpoints degrade gracefully (they read Postgres). Writes that need the
  distributed lock or queue will fail closed. Restart Redis and the worker.

## Provider outage (Bitcoin / PRECOP)

- The health state moves to `DEGRADED`/`UNSAFE`. The UI shows a banner and
  disables transactions; read-only application state remains available.
- Restore connectivity and confirm `protocol/status` returns `synced`.

## State mismatch (indexer vs protocol)

1. `GET /api/protocol/status` — inspect `stateHash`, lag, write mode.
2. If the state hash mismatches, writes are disabled automatically.
3. Run `pnpm reindex` to reconcile the projection, then re-check.

## Reorg

- Reorgs ≥ 2 blocks raise an alert and are recorded in `reorg_events`.
- Projections are reconciled to the canonical chain by the worker; `canonical`
  flags mark orphaned events (evidence is never deleted).
- Tokens may enter `REORG_RECOVERY`; the worker re-syncs them to their correct
  state. Graduation transactions that were broadcast trigger `GRADUATED →
  REORG_RECOVERY`; otherwise `GRADUATING → LIVE`.

## Transaction rejection spike

1. Check `chain_transactions.error_code` for the dominant code.
2. Common causes: `SUPPLY_CHANGED` / `QUOTE_EXPIRED` (price moved), `TX_REJECTED`
   (node rejected), `TX_FEE_TOO_HIGH` (fee protection).
3. If a mainnet write invariant fails, the corresponding write feature is paused
   (fail closed). Investigate before re-enabling.

## Graduation stuck

1. Confirm `confirmed_minted_atoms == 840,000,000`.
2. Confirm the final mint reached the finality threshold (default 6 confirmations;
   `FINALITY_CONFIRMATIONS`).
3. Confirm reserve is independently verified (expected vs observed — a mismatch
   disables graduation).
4. Confirm `CRC_GRADUATION_MAINNET_ENABLED` + `CRC_PROTOCOL_VERIFIED` (mainnet).
