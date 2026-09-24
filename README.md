# CRC Launch

**Launch CRC-20 assets with a progressive fair mint, then trade them on a non-custodial marketplace.**

The product loop: **CREATE → DEPLOY → PROGRESSIVE MINT → PRICE INCREASES → SOLD OUT → GRADUATION → MARKETPLACE → BUY / SELL**.

CRC Launch is a monorepo of a Next.js web app, an indexer worker, and a set of
domain packages (curve engine, protocol adapters, Bitcoin provider, wallet
abstraction, database, schemas). It **never custodizes private keys** — every
value-moving transaction is signed by the user's own Bitcoin wallet.

> ⚠️ **Mainnet status:** all mainnet *write* operations are **UNVERIFIED** and
> disabled by default. See [docs/PROTOCOL_VERIFICATION.md](docs/PROTOCOL_VERIFICATION.md).
> The product is fully functional end-to-end in **mock mode**.

> 🔑 **Test keys are burners — never fund them.** The WIF
> `cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW` and the `0x42`×32 /
> `0x43`/`0x44`/`0x45`… deterministic private keys that appear in
> `packages/cove-guardian/src/tx.test.ts`, `regtest-proof.ts`, and the regtest
> fixtures are **public test fixtures**. They are intended for REGTEST only and
> must **never** be funded with real BTC or used as production keys.

---

## Architecture

```
apps/
  web/       Next.js 15 app (UI + API routes)
  worker/    Indexer worker (BullMQ + mock block production)
packages/
  curve/     Progressive Mint Curve engine (pure BigInt, 100% coverage)
  protocol/  CRCProtocolAdapter + MockCRCAdapter + PrecopCRCAdapter (gated)
  bitcoin/   BitcoinProvider + MockBitcoinProvider
  wallets/   WalletAdapter + MockWalletAdapter
  db/        Drizzle schema, migrations, repositories, state machines
  schemas/   Zod input schemas
  config/    Env loading, feature flags, mainnet safety gates
docs/        ARCHITECTURE, PROTOCOL_VERIFICATION, THREAT_MODEL, RUNBOOK, MAINNET_CHECKLIST
```

The database is **only a projection/cache**; chain/protocol state is the source
of truth. The indexer runs as an independent worker and is never invoked in the
web request lifecycle.

---

## Local installation

Prerequisites: Node ≥ 20, pnpm ≥ 10, PostgreSQL 16, Redis.

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres + Redis (or use the provided compose file)
docker compose up -d          # postgres:16 + redis:7 on :5432 / :6379

# 3. Configure environment
cp .env.example .env           # defaults target localhost Postgres/Redis

# 4. Create the database (once)
psql -c "CREATE ROLE crclaunch LOGIN PASSWORD 'crclaunch';" postgres
psql -c "CREATE DATABASE crclaunch OWNER crclaunch;" postgres

# 5. Migrate
pnpm db:migrate
```

## Running in mock mode (default)

```bash
# Terminal 1 — indexer worker (mines mock blocks, syncs events → DB)
pnpm --filter @crclaunch/worker dev

# Terminal 2 — web app
pnpm --filter @crclaunch/web dev
```

Open http://localhost:3000. Mock mode ships with demo tokens `FROG`, `DOGE`,
`MOON`, `TREE` and supports the complete loop without any real Bitcoin:

**launch a token → mint it → cross stages → sell out → graduate → list → buy**,
all non-custodial, using a mock wallet that auto-connects.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test            # unit tests (curve 100% coverage, protocol, db)
pnpm test:e2e        # Playwright (starts web + worker; needs DB + Redis up)
pnpm test:integration # DB reorg integration (clean-reindex equality; needs Postgres)
pnpm build           # production build
```

## Mainnet read mode

Set `CRC_NETWORK=mainnet-read-only` and provide `CRC_PROTOCOL_URL`. The app
renders real network/protocol state without any write capability.

## Mainnet write mode

**Impossible to activate accidentally.** Each operation requires BOTH a specific
feature flag AND `CRC_PROTOCOL_VERIFIED=true`:

```env
CRC_PROTOCOL_VERIFIED=false
CRC_DEPLOY_MAINNET_ENABLED=false
CRC_MINT_MAINNET_ENABLED=false
CRC_MARKET_MAINNET_ENABLED=false
CRC_GRADUATION_MAINNET_ENABLED=false
```

No mainnet adapter method returns a transaction unless its operation is
`VERIFIED` in `docs/PROTOCOL_VERIFICATION.md`.

## Reindexing

Blockchain projections are reproducible from chain state:

```bash
pnpm reindex
```

A total database loss does not imply loss of user funds.

## Deployment

`apps/web` is a standard Next.js app (`pnpm build` → `pnpm start`); `apps/worker`
runs under `tsx`/Node. See `.env.example` for required production variables and
`docs/MAINNET_CHECKLIST.md` before enabling any mainnet write.

## CI and branch protection

Two GitHub Actions workflows gate the repo:

- `.github/workflows/ci.yml` — `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build` on every push and pull request.
- `.github/workflows/cove-regtest.yml` — real Bitcoin Core regtest lifecycle +
  reorg recovery (downloads a pinned, checksum-verified Bitcoin Core release).

Branch protection must be configured in GitHub (Settings → Branches) to require
**both** workflows as status checks on `main`; that setting lives in GitHub, not
in this repo, so it cannot be encoded here and must not be forgotten.

---

*CRC Launch will never ask for your seed phrase or private key.*
