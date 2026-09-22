# Architecture

## Components

```
                    ┌─────────────────────────────┐
                    │   Browser (Next.js web)     │
                    │  React UI + WalletAdapter   │
                    └──────────────┬──────────────┘
                                   │ HTTP (API routes)
                    ┌──────────────▼──────────────┐
                    │   apps/web (API layer)      │
                    │  quotes, builds, broadcasts │
                    │  read endpoints (DB)        │
                    └───┬──────────────┬──────────┘
                        │              │
        ┌───────────────▼───┐    ┌─────▼───────────────┐
        │  PostgreSQL (Drizzle)│    │  Redis (cache/lock) │
        │  projection/cache   │    │  mock chain state   │
        └───────▲───────────┘    └─────▲───────────────┘
                │                      │
        ┌───────┴───────────┐    ┌─────┴───────────────┐
        │  apps/worker       │    │  Protocol adapter    │
        │  indexer (BullMQ)  │    │  MockCRCAdapter      │
        │  mock block mining │    │  PrecopCRCAdapter    │
        │  reorg handling    │    │  (gated, read-only)  │
        └───────────────────┘    └─────────────────────┘
```

## Packages

- **`packages/curve`** — the Progressive Mint Curve. Pure BigInt. Canonical 20-stage
  table, `quoteExactTokens`/`quoteExactSats`, fee math, minimum contribution.
  100% test coverage; no UI reimplements curve math.
- **`packages/protocol`** — `CRCProtocolAdapter` interface + `MockCRCAdapter`
  (simulated chain, Redis-backed state) + `PrecopCRCAdapter` (mainnet, every
  build method gated by an operation VERIFIED registry). Also the shared
  `MockChainNode` used by both web and worker.
- **`packages/bitcoin`** — `BitcoinProvider` abstraction + `MockBitcoinProvider`.
- **`packages/wallets`** — `WalletAdapter` interface + `MockWalletAdapter`.
- **`packages/db`** — Drizzle schema (20 tables), SQL migrations, repositories,
  and explicit transaction/token/listing state machines.
- **`packages/schemas`** — Zod schemas for all API inputs.
- **`packages/config`** — env parsing, validation, mainnet safety gates.

## Data flow (mock mode)

1. Web app reads/writes **protocol state** through `MockChainNode` (shared via
   Redis so web + worker see one chain).
2. The worker mines a block every `MOCK_BLOCK_INTERVAL_MS`, then enqueues a
   BullMQ **sync job**.
3. The sync job idempotently upserts chain events and derives projections
   (tokens, balances, listings, trades, mints) into PostgreSQL.
4. Web **reads** (homepage, token pages, activity, portfolio) come from the DB
   projection; web **writes** (quote/build/broadcast) go to the protocol adapter.

This mirrors the real architecture: the API never indexes, and the database is
never the source of truth for money movement.

## Key invariants

- Monetary math is integer-only (`bigint`); DB monetary columns are `BIGINT`.
- Every state-changing API accepts an `Idempotency-Key`; DB unique constraints
  make event/transaction ingestion idempotent.
- Reorgs reconcile projections to the canonical chain (mock chain rebuilds
  derived state; the worker re-syncs; `reorg_events` records forensics).
- A stale quote cannot be signed: quotes bind to a protocol state hash and
  expire by time and height.
- Mempool is never treated as final; graduation waits for a configurable
  finality threshold.

## Trust model (adversarial hardening)

Transaction construction is convenience only. Canonical state is produced by
**independently validating every operation against deterministic protocol
rules**, never by trusting the requestor:

- **Frontend is untrusted** — the UI is a convenience wrapper.
- **Builder is untrusted** — a malicious client may construct its own transaction.
- **Payload is untrusted** — payment/fee/price/address/ticker claims are ignored.
- **Indexer/validator recomputes all material state** from canonical prior state,
  the transaction signer, transaction outputs, and deterministic rules
  (`packages/protocol/src/mock/chain.ts` `validateTx` → `applyNormalized`).

The validator derives actual payments from transaction **outputs** (address +
amount) against the canonical protocol config (`packages/protocol/src/validation/config.ts`),
not from payload fields. See `packages/protocol/src/mock/adversarial.test.ts` for
the tampered-transaction attack matrix.
