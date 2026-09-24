# Runbook — Database Backup / Restore / Reindex Drills

## What is disposable vs durable

- **Rebuildable**: `cove_v3_blocks/events/undo/token_utxos/backing_states/tokens/cursor`
  (derived chain projection — rebuilt by `reindexDb`).
- **Durable (must be backed up)**: `cove_v3_token_metadata`,
  `cove_v3_market_*`, `cove_v3_app_transactions`, `cove_v3_guardian_audit`,
  `cove_v3_signing_journal`, `feature_flags`.

## Backup (encrypted, verified)

```bash
pg_dump "$COVE_DATABASE_URL" --no-owner --format=custom \
  --file="cove-$(date +%Y%m%d-%H%M%S).dump"
# encrypt + record checksum with your KMS/ops tooling, then verify restorability.
```

## Restore drill (into a SEPARATE environment)

```bash
createdb cove_restore_check
pg_restore --no-owner --dbname=cove_restore_check cove-....dump
# restart worker against cove_restore_check; run:
pnpm --filter @crclaunch/cove-indexer v3:verify
```

Assert: state root equal, token metadata + signed listings + cancellations +
app sessions + Guardian audit chain + signing journal all present.

## Chain-projection rebuild drill

```bash
pnpm --filter @crclaunch/cove-indexer v3:reindex   # drops derived chain projection only
pnpm --filter @crclaunch/cove-indexer v3:verify
pnpm --filter @crclaunch/cove-indexer v3:verify -- --full
```

Assert: rebuilt root == pre-rebuild root; market/application/audit rows survive.

## What must NOT be done

- Do not rebuild the signing journal from "absence" (data loss ⇒ Guardian HALT).
- Do not restore into the live production DB over an unverified dump.
