# Cove

**A CRC-family token protocol on Bitcoin L1 — state-committed Taproot UTXOs,
an open indexer, and a non-custodial marketplace.**

Cove issues tokens whose protocol state is committed into the Taproot output
key of a live UTXO. A token's history is a chain of on-chain state transitions —
`DEPLOY → MINT → TRANSFER → REDEEM` — each one an ordinary, consensus-valid
Bitcoin transaction. Anyone can run the indexer and independently reproduce the
same state root from the same blocks.

Cove sits in the CRC category but runs its own protocol. The wire identifier is
**`cove-20`**, deliberately distinct from `crc-20`: sharing a tag would mean
sharing a ledger, and a third party's closed indexer would decide what a Cove
token is worth. Separate tag, open indexer, reproducible state.

---

## What Bitcoin enforces, and what it does not

This is the first thing to understand about Cove, and we state it plainly
rather than burying it.

**Bitcoin enforces:** the Taproot signature on the spend, the UTXO set (no
double-spend, no inflation of BTC), and that the successor output exists with
the exact value and script the transaction commits to.

**Bitcoin does not enforce the token rules.** A Guardian validates each
transition — supply conservation, the issuance curve, payment amounts, the
recovery profile — and signs only if it passes. Bitcoin will not reject an
invalid Cove transition; the indexer ignores it.

So Cove is **client-validated**, like every Bitcoin metaprotocol today. There
are no covenants on Bitcoin mainnet — every proposal (CTV, OP_CAT, APO, CSFS)
is still a draft. What Cove does differently is make the validator reproducible:
the indexer is in this repository, the state root is deterministic, and two
independent operators can check each other. See
[`docs/TRUST_MODEL.md`](docs/TRUST_MODEL.md) for the full model.

---

## How it works

```
DEPLOY ──► state-committed P2TR vault (NUMS internal key, MAST)
             │
   MINT ─────┤  Guardian validates the real PSBT, runs the Simplicity
             │  predicate, then signs the execution leaf
             ▼
           successor vault  (new state → new output key → new address)
             │
TRANSFER ────┤  token UTXOs move between owners
REDEEM ──────┘  burn tokens, release the backing BTC
```

Each vault's output key is `Q = P + H_TapTweak(P ‖ stateCommitment)·G`, so the
address itself is a commitment to the protocol state. The vault carries three
tapleaves: MINT and REDEEM execution paths bound to a Simplicity program
commitment (CMR), and a **2-of-3 threshold recovery leaf** behind a relative
timelock.

The issuance curve is a frozen 20-stage integer staircase. All arithmetic is
`bigint`; there is no floating point anywhere in the consensus path.

---

## Repository layout

| Package | Purpose |
| --- | --- |
| `packages/cove-wire` | Wire envelope: fixed-width binary, versioned, `COVE` magic |
| `packages/cove-covenant` | State encoding, state hash, transition rules |
| `packages/cove-vault` | Taproot vault construction, MAST, recovery profiles |
| `packages/cove-simplicity` | Simplicity predicate (Rust) + Bit Machine execution |
| `packages/cove-guardian` | Transition validation and signing; custody backend interface |
| `packages/cove-indexer` | Deterministic indexer, state root, reorg recovery, Postgres |
| `packages/cove-market` | Signed listings, PSBT atomic settlement, reconciliation |
| `packages/cove-economics` | Frozen issuance curve and fee schedule |
| `packages/cove-mainnet` | Canonical mainnet profile: one schema, parser, validator, hash |
| `packages/cove-app` | Application service, readiness aggregation, durable stores |
| `packages/cove-recovery` | Offline threshold-recovery tool |
| `packages/bitcoin` | PSBT construction, dust policy, Core RPC and Esplora providers |
| `apps/web` | Next.js application |
| `apps/guardian` | Standalone Guardian service (sign-only HTTP API) |
| `apps/worker` | Indexer worker |

`packages/protocol`, `packages/curve` and the V1 paths under `docs/legacy/` are
the earlier OP_RETURN/indexer-authoritative design, retained for its regression
suite. New work targets the Cove V3 packages above.

---

## Getting started

Requires Node 22, pnpm 10, Postgres 16, and Rust (for the Simplicity binary).

```bash
pnpm install
cp .env.example .env          # then edit DATABASE_URL

docker compose up -d postgres
pnpm db:migrate

pnpm typecheck && pnpm lint && pnpm test
```

Build the Simplicity predicate and verify the frozen CMRs:

```bash
cd packages/cove-simplicity/rust && cargo build --release
```

---

## Proofs

Every claim in this repository has an executable proof against real Bitcoin
Core — not a mock. These run in CI on every push to `main` and every pull
request.

```bash
pnpm cove:regtest-proof            # state-committed vault spend
pnpm cove:csv-proof                # NUMS/MAST, 144-block CSV recovery leaf
pnpm cove:v3-regtest-lifecycle     # DEPLOY → MINT → TRANSFER → REDEEM
pnpm cove:regtest-reorg            # reorg recovery, root == clean replay
pnpm cove:signet-proof             # signet lifecycle, real broadcast
pnpm cove:liquidity-demo           # graduation + constant-product pool
```

| Workflow | Proves |
| --- | --- |
| `ci` | typecheck, lint, test, build |
| `cove-v3-lifecycle` | full lifecycle against real `bitcoind` |
| `cove-v3-indexer` | persistence, reorg recovery, backup/restore round-trip |
| `cove-v3-market` | P2P listing, fill, settlement |
| `cove-v3-product` | browser end-to-end against a real node |
| `cove-simplicity` | Simplicity ↔ TypeScript differential, frozen CMRs |
| `cove-vault-csv` | vault script paths |
| `cove-v3-mainnet-readiness` | readiness gate against a real Guardian |

---

## Mainnet status

**Mainnet is not activated.** `COVE_V1_MAINNET_GENESIS_HEIGHT = 0` and every
`COVE_*_MAINNET_ENABLED` flag defaults to `false`. The Guardian refuses to boot
on mainnet with a development key, and the only other custody backend fails
closed on every call — so the mainnet signing path cannot produce a signature
today. That is deliberate.

Consensus configuration — activation height, Guardian key, recovery keys, fee
destination — lives in a committed constant, never in the environment. The
runtime may only *verify* against it; a mismatch is fatal.

Check readiness at any time:

```bash
pnpm cove:v3-mainnet-readiness --static    # profile completeness
pnpm cove:v3-mainnet-readiness --runtime   # live Core, Guardian, indexer probes
```

Remaining work before a controlled canary is tracked in
[`docs/MAINNET_V3_CHECKLIST.md`](docs/MAINNET_V3_CHECKLIST.md); the operator
procedure is [`docs/CANARY_DAY_ONE.md`](docs/CANARY_DAY_ONE.md).

---

## Security

Cove has been through three independent adversarial audits covering the
Guardian signing path, the activation gates, and the marketplace. Findings and
the fixes that closed them are in the git history.

**The Guardian key is the trust boundary.** Bitcoin enforces that funds move to
*a* state-committed successor; the Guardian decides *which*. A compromised
Guardian cannot inflate supply or steal backing satoshis — the policy engine
recomputes every amount from canonical state and validates the real
transaction — but it is the component to protect.
[`docs/GUARDIAN_CUSTODY.md`](docs/GUARDIAN_CUSTODY.md) covers backend options.

Key material is never held by the application. The ceremony tool writes each
private key to a separate `0600` file and prints only x-only public keys:

```bash
pnpm cove:ceremony-keys --out /Volumes/<removable>/ceremony
```

> The WIF and `0x42`-style keys in the test suite are **publicly known burner
> keys**. Never fund them.

Report a vulnerability privately via GitHub Security Advisories rather than a
public issue.

---

## Documentation

| Document | |
| --- | --- |
| [`TRUST_MODEL.md`](docs/TRUST_MODEL.md) | What Bitcoin enforces vs. what the Guardian enforces |
| [`COVE_PROTOCOL_V1.md`](docs/COVE_PROTOCOL_V1.md) | Wire format, byte layout, test vectors |
| [`COVE_VAULT.md`](docs/COVE_VAULT.md) | Taproot construction, MAST, recovery |
| [`COVE_BACKING.md`](docs/COVE_BACKING.md) | Backing, issuance curve, redemption |
| [`COVE_MARKET.md`](docs/COVE_MARKET.md) | Listings, settlement, reconciliation |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System overview |
| [`THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Threat model |
| [`GUARDIAN_CUSTODY.md`](docs/GUARDIAN_CUSTODY.md) | Custody backend selection |
| [`MAINNET_RECOVERY_CEREMONY.md`](docs/MAINNET_RECOVERY_CEREMONY.md) | 2-of-3 recovery procedure |
| [`runbooks/`](docs/runbooks) | Backup/restore, canary operations, recovery |

---

## License

MIT
