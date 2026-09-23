# Cove V1 — Bitcoin-Anchored Open Meta-Protocol (Signet)

Cove is an open, deterministic meta-protocol anchored on Bitcoin. This document
specifies **Cove V1** for **Bitcoin signet**. It is a fresh protocol (id `cove`,
version `1`), not CRC-20 and not CRC Garden. It reuses only the canonical
`@crclaunch/curve` economics, which the indexer recomputes independently.

> Status: specification + deterministic validator/indexer + PSBT builders.
> No mainnet writes. No private keys server-side. Marketplace remains mock-only.

---

## 1. Trust model (summary)

Bitcoin is the event log. A transaction builder, frontend, API caller, wallet,
and the OP_RETURN payload are all **untrusted**. The validator/indexer derives
validity from canonical state + signer/ownership + outputs + rules only.
See [`TRUST_MODEL.md`](./TRUST_MODEL.md).

---

## 2. Unit model (frozen)

- `decimals = 8`; `ATOMS_PER_TOKEN = 100,000,000` (1e8).
- **1 display token = 100,000,000 atoms.**
- `totalSupply = 1,000,000,000 display tokens = 100,000,000,000,000,000 atoms` (1e17, fits uint64).
- `publicSupply = 840,000,000 display tokens = 84,000,000,000,000,000 atoms`.
- `graduationReserve = 160,000,000 display tokens`.
- `TOKENS_PER_STAGE = 42,000,000 display tokens = 4,200,000,000,000,000 atoms`.
- `PRICE_UNIT = 1,000,000 display tokens = 100,000,000,000,000 atoms` (1e14).

Consensus amounts are **atoms** (uint64 big-endian). The curve is priced in
**sats per PRICE_UNIT** (i.e. sats per 1,000,000 display tokens); the golden
full-public-mint contribution is **24,196,788 sats** (unchanged).

---

## 3. Wire format (canonical binary envelope)

The envelope is a fixed-length big-endian binary payload in a single OP_RETURN
push at **vout 0**.

```
magic      4 bytes   0x43 0x4F 0x56 0x45  ("COVE")
version    1 byte    0x01
opcode     1 byte    DEPLOY=0x01, MINT=0x02, TRANSFER=0x03
ticker     4 bytes   ASCII, each [0-9A-Z]
amount     8 bytes   uint64 BE, atoms   (MINT / TRANSFER only)
supply     8 bytes   uint64 BE, atoms   (MINT only)
```

| op       | length | bytes                            |
| -------- | ------ | -------------------------------- |
| DEPLOY   | 10     | magic(4) ver(1) op(1) tick(4)    |
| MINT     | 26     | … tick(4) amount(8) supply(8)    |
| TRANSFER | 18     | … tick(4) amount(8)              |

Rules: exact length per opcode; magic/version/opcode/ticker strict; amount and
supply are big-endian uint64 atom values. Any deviation ⇒ `MALFORMED_COVE`.
Payloads are 10–26 bytes, intentionally compact for broad relay compatibility
(Bitcoin Core's default OP_RETURN datacarrier is 80 bytes — a **relay policy**,
not a consensus rule; Cove stays compact by design).

---

## 4. Vout layout

All layouts start with the envelope at **vout 0**. Outputs after the protocol
outputs are change (ignored by the indexer).

### DEPLOY

| vout | role        | value                  | script |
| ---- | ----------- | ---------------------- | ------ |
| 0    | envelope    | 0                      | OP_RETURN |
| 1    | launch-fee  | exactly 10,000 sats    | canonical treasury |
| 2+   | change      | remainder − miner fee  | actor change |

### MINT

| vout | role        | value                          | script |
| ---- | ----------- | ------------------------------ | ------ |
| 0    | envelope    | 0                              | OP_RETURN |
| 1    | recipient   | ≥ dust(recipient script)       | recipient (P2WPKH/P2TR) |
| 2    | settlement  | **exactly** curve + platform fee | canonical settlement script |
| 3+   | change      | remainder − miner fee          | actor change |

`requiredCurve = quoteExactTokens(amountTokens, supplyBeforeTokens).curveContributionSats`
(≥ `MIN_CONTRIBUTION_SATS` = 1,000), `platformFee = ceil(curve × 100 / 10000)`,
`settlement = curve + platformFee`. The indexer records
`reserveSats += curve` and `platformTreasurySats += platformFee` separately even
though the Bitcoin payment is a **single combined output**. There is no separate
5-sat treasury output, so no dust protocol output is ever created.

### TRANSFER

| vout | role          | value                        | script |
| ---- | ------------- | ---------------------------- | ------ |
| 0    | envelope      | 0                            | OP_RETURN |
| 1    | recipient     | ≥ dust(recipient script)     | recipient (P2WPKH/P2TR) |
| 2    | continuation  | ≥ dust(actor script)         | **actor** script |
| 3+   | change        | remainder − miner fee        | actor change |

The continuation output guarantees the actor retains a spendable UTXO at its
own script, so rotating wallet change cannot strand token balances.

---

## 5. Authorization

- **Actor** = input 0's spent-UTXO `scriptPubKey` (hex). Exact templates only:
  P2WPKH `00 14 <20 bytes>` (22 bytes) or P2TR `51 20 <32 bytes>` (34 bytes).
- **Recipient** = vout 1's `scriptPubKey`. No arbitrary `from`/`to` in the payload.

---

## 6. Deterministic state

Cove state is a pure function of `(network, genesis height, canonical blocks,
version)`:

```
state = fold(applyCoveOperation, emptyState, validatedOps in (height ASC, txIndex ASC))
```

- `deploy` registers the ticker (deploymentId = the deploy txid).
- `mint` credits `recipient` with `amount` atoms; reserve/treasury accounting is split.
- `transfer` moves `amount` atoms actor → recipient (available = balance − locked).
- `computeStateRoot()` = sha256 of canonically-sorted tokens, ticker map,
  balances (available+locked), reserve sats, treasury sats — no timestamps/DB IDs.

---

## 7. Activation + network

- `COVE_V1_SIGNET_GENESIS_HEIGHT = 323323` (signet tip at Cove V1 activation).
  The indexer ignores Cove-looking transactions below this height. Canonical
  replay always begins here (or a verified checkpoint).
- `COVE_V1_MAINNET_GENESIS_HEIGHT = null` — mainnet is **not** activated.
- On startup the indexer verifies `getblockchaininfo.chain === "signet"` and
  fails closed otherwise.

---

## 8. Implemented surface

- `packages/curve` — display-token + atom units, canonical pricing.
- `packages/bitcoin` — decoder, strict `parseCanonicalOpReturn`, signet RPC
  provider, dust thresholds, PSBT builder.
- `packages/protocol/src/cove` — binary envelope, types, mapper, validator,
  state root, PSBT builders, canonical config.
- `packages/cove-indexer` — deterministic `CoveIndexer` + CLI
  (`cove:index` / `cove:verify` / `cove:status`).

Not in this sprint: marketplace, graduation liquidity, CRC Garden compat,
PRECOP oracle, CRC-404, DAO, rebasing, referrals, points, mainnet writes.
