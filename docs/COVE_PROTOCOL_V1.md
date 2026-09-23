# Cove V1 — Bitcoin-Anchored Open Meta-Protocol

Cove is an open, deterministic meta-protocol anchored on Bitcoin. This document
specifies **Cove V1** for **Bitcoin signet**. It is a fresh protocol (id `cove`,
version `1`), not CRC-20 and not CRC Garden: it reuses only the canonical
`@crclaunch/curve` economics, which the indexer recomputes independently.

> Status: **specification + deterministic validator/indexer + PSBT builders.**
> No mainnet writes. No private keys server-side. Marketplace remains mock-only.

---

## 1. Trust model (summary)

Bitcoin is the event log. A transaction builder, a frontend, an API caller, and
the payload inside OP_RETURN are all **untrusted**. The validator/indexer
derives validity from canonical state + signer/ownership + outputs + rules only.
See [`TRUST_MODEL.md`](./TRUST_MODEL.md) for the full adversarial model.

The four canonical facts the indexer trusts:

1. **Canonical Bitcoin blocks** (the chain).
2. **Ownership** — who controls input 0's spent UTXO scriptPubKey.
3. **Outputs** — the exact vout layout and satoshi values.
4. **Rules** — the curve, fees, and layout, recomputed locally.

Everything else — including the JSON in OP_RETURN — is a *claim* that must match
the canonical facts, or the operation is rejected.

---

## 2. Wire format

Every Cove operation is a Bitcoin transaction whose **vout 0** is an OP_RETURN
carrying a single push of canonical UTF-8 JSON:

```json
{"p":"cove","v":1,"op":"<deploy|mint|transfer>", ...}
```

Constraints (enforced by `parseCoveEnvelope`):

- `p` must be exactly `"cove"`; `v` must be exactly `1`.
- The payload must be **≤ 80 bytes** (Bitcoin's standard OP_RETURN datacarrier
  limit) so it relays on signet.
- Canonical JSON: no duplicate keys, no leading-zero integers, no fractional
  amounts, no unknown fields that change semantics, fatal UTF-8.
- Deployments are referenced by their **4-character ticker** (`tick`), which is
  unique (first DEPLOY of a ticker wins, in block order). A 64-hex txid
  reference is intentionally *not* used — it would exceed the 80-byte budget
  for mint/transfer envelopes.
- Amounts are **whole tokens** (the canonical curve unit), never floats and
  never 8-decimal "atoms". See §5.

### Field reference

| op       | fields                          | notes                                  |
| -------- | ------------------------------- | -------------------------------------- |
| `deploy` | `tick`                          | `^[A-Z0-9]{4}$`, unique                |
| `mint`   | `tick`, `amt`, `s`              | `amt` = tokens to mint, `s` = supply before (whole tokens) |
| `transfer` | `tick`, `amt`                | `amt` = tokens to move                 |

---

## 3. Vout layout

All layouts start with the OP_RETURN at **vout 0**. Any output after the
protocol outputs is change (ignored by the indexer).

### DEPLOY

| vout | role        | value                          | script   |
| ---- | ----------- | ------------------------------ | -------- |
| 0    | envelope    | 0                              | OP_RETURN |
| 1    | launch-fee  | exactly 10,000 sats            | canonical treasury |
| 2+   | change      | remainder − miner fee          | actor change |

### MINT

| vout | role        | value                          | script   |
| ---- | ----------- | ------------------------------ | -------- |
| 0    | envelope    | 0                              | OP_RETURN |
| 1    | recipient   | dust (546 sats)                | recipient (P2WPKH/P2TR) |
| 2    | curve       | **exactly** the recomputed curve contribution | canonical reserve |
| 3    | platform-fee| **exactly** the recomputed fee (1%)            | canonical treasury |
| 4+   | change      | remainder − miner fee          | actor change |

### TRANSFER

| vout | role      | value          | script   |
| ---- | --------- | -------------- | -------- |
| 0    | envelope  | 0              | OP_RETURN |
| 1    | recipient | dust (546 sats)| recipient (P2WPKH/P2TR) |
| 2+   | change    | remainder − miner fee | actor change |

Token balances live in indexer state, not in the recipient's satoshi value. The
546-sat recipient output is dust to make the output relayable; the token amount
is conveyed only by the OP_RETURN envelope and settled by the validator.

---

## 4. Authorization

- **Actor** = input 0's spent-UTXO `scriptPubKey` (hex). The transaction must
  actually spend it (Bitcoin enforces the signature). P2WPKH (`0014…`) and P2TR
  (`5120…`) are supported; P2PKH/P2SH are rejected.
- **Recipient** = vout 1's `scriptPubKey` (mint/transfer). There is no
  arbitrary `from`/`to` in the JSON — ownership is always derived from what
  Bitcoin commits to.

---

## 5. Units and economics

- **Whole tokens** are the only unit. Total supply = 1,000,000,000 tokens;
  public supply = 840,000,000; reserve = 160,000,000; 0 premine.
- The 20-stage progressive curve (`@crclaunch/curve`) prices **whole tokens**
  at `500 … 149,731` sats per 1,000,000 tokens. The indexer recomputes the
  exact curve contribution and the 1% platform fee for every mint — it never
  trusts the amounts asserted by the builder.
- Launch fee = 10,000 sats. Platform fee = 1% (100 bps), rounded **up**, charged
  in addition to the curve contribution.
- All arithmetic is `BigInt`. No floats.

---

## 6. Deterministic state

Cove state is a pure function of `(network, genesis height, canonical blocks,
protocol version)`:

```
state = fold(applyCoveOperation, emptyState, validatedOps-in-block-order)
```

- `deploy` registers the ticker (deploymentId = the deploy txid).
- `mint` credits `recipient` with `amt` tokens and accumulates reserve/treasury.
- `transfer` moves `amt` tokens from actor to recipient (available = balance − locked).
- A reorg is handled by rebuilding from the canonical chain — the same blocks
  always produce the same `computeStateRoot()` (sha256 of the canonically-sorted
  token/balance/reserve/treasury projection). See the indexer's replay tests.

---

## 7. Implemented surface

- `packages/bitcoin` — decoder (`decodeRawTransaction`, `opReturnPayload`,
  `outputAddress`), signet RPC provider (`CoreRpcProvider`), PSBT builder.
- `packages/protocol/src/cove` — parser, types, mapper, validator, state root,
  PSBT builders (`buildCoveDeployPsbt` / `buildCoveMintPsbt` / `buildCoveTransferPsbt`).
- `packages/cove-indexer` — deterministic `CoveIndexer` + CLI:
  - `pnpm cove:index [--from N --to N]` — scan real signet blocks.
  - `pnpm cove:verify [--from N --to N]` — re-index and compare roots.
  - `pnpm cove:status` — show config + empty-state root.
- `docs/COVE_V1_TEST_VECTORS.json` — golden + malicious vectors.

Not in this sprint: marketplace, graduation liquidity, CRC Garden compat,
PRECOP oracle, CRC-404, DAO, rebasing, referrals, points, mainnet writes.
