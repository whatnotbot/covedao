# Cove Trust Model — Validate, Never Trust

The invariant:

> **A transaction builder, frontend, API caller, wallet, and the OP_RETURN
> payload are all untrusted.** The deterministic validator/indexer derives
> validity from canonical state + signer/ownership + outputs + rules.

## Cove is CLIENT-VALIDATED — Bitcoin does not enforce it

This is the single most important assumption in this document.

- **Bitcoin validates Bitcoin consensus rules only**: UTXO spends, script and
  signature execution, and value conservation (no inflation). It does **not**
  validate any Cove-specific rule — ticker uniqueness, supply, balances, the
  pricing curve, fees, or transfer semantics. All of those are Cove-indexer
  rules.
- **Bitcoin does NOT reject**: a DEPLOY of a taken ticker, a MINT of
  900,000,000 tokens, a MINT paying 1 sat, or a TRANSFER of tokens never owned.
  All of these confirm on-chain and are then **ignored by the indexer**.
- **Token supply is a claim made by whoever runs the indexer.** The difference
  from a closed metaprotocol is that this indexer is open and anyone can
  reproduce it — not that Bitcoin enforces it.
- A transaction is only valid Cove if it pays the hardcoded treasury and
  settlement scripts in `packages/protocol/src/cove/config.ts`. That makes Cove
  a **payment-gated token standard with one beneficiary**, not an open
  meta-protocol. This is the intended design — but it is stated explicitly.

## Canonical facts (trusted)

| Fact     | Source                                             |
| -------- | -------------------------------------------------- |
| Chain    | Canonical Bitcoin signet blocks, in order (height ASC, txIndex ASC) |
| Ownership| Input 0's spent-UTXO `scriptPubKey` (Bitcoin-enforced signature) |
| Outputs  | The exact vout layout + satoshi values in the tx   |
| Rules    | Curve, fees, layout, dust, recomputed locally      |

## Adversarial claims (verified)

| Claim                 | How checked                                                      |
| --------------------- | ---------------------------------------------------------------- |
| "I am actor X"        | Derived from input 0 spent UTXO script, not from payload          |
| "send to recipient Y" | Derived from vout 1 scriptPubKey                                  |
| `amt`, `supply`       | Cross-checked vs canonical state + recomputed curve               |
| settlement sats       | Recomputed; vout 2 must match **exactly** (curve + platform fee)  |
| launch fee            | vout 1 must equal 10,000 sats to canonical treasury               |
| ticker uniqueness     | Canonical ticker index (first deploy in txIndex order wins)       |
| balance sufficiency   | Canonical balances (available = balance − locked)                 |
| continuation          | vout 2 (transfer) must be the actor script, dust-safe             |

## Rejection codes

Each code below means "**rejected by the indexer**" — the Bitcoin transaction
still confirms; the indexer simply does not apply it to Cove state.

`TICKER_TAKEN`, `STALE_SUPPLY`, `OVERMINT`, `BELOW_MIN_CONTRIBUTION`,
`SUBTOKEN_MINT_UNSUPPORTED`, `UNDERPAYMENT`, `OVERPAYMENT`, `WRONG_TREASURY`,
`WRONG_SETTLEMENT_SCRIPT`, `WRONG_RECIPIENT`, `WRONG_CONTINUATION`,
`MISSING_CONTINUATION`, `INVALID_OUTPUT_LAYOUT`, `UNSUPPORTED_ACTOR_SCRIPT`,
`INVALID_RECIPIENT`, `SELF_TRANSFER`, `INSUFFICIENT_AVAILABLE_TOKENS`,
`ZERO_AMOUNT`, `RECIPIENT_ANCHOR_DUST`, `CONTINUATION_DUST`,
`MULTIPLE_COVE_OPERATIONS`, `MALFORMED_COVE`, `UNSUPPORTED_VERSION`.

## Dust (relay policy, not consensus)

Outputs are checked against Bitcoin Core's `GetDustThreshold` (3 sat/vB):
P2WPKH = 294 sats, P2TR = 330 sats, P2PKH = 546 sats. Recipient anchors and
continuation outputs must be dust-safe. The mint settlement is one combined
output (curve + platform fee), so no 5-sat treasury dust output exists.

## Rules of the wire format

- Binary envelope: `COVE` magic + version + opcode + ticker + uint64 BE atoms.
- Canonical OP_RETURN: `OP_RETURN <single minimal push> <end>` — no trailing
  data, no non-minimal push, no multiple Cove envelopes per tx.
- Arbitrary non-Cove OP_RETURN (e.g. `coinbin.org`) is **NOT** invalid Cove; it
  is simply `NON_COVE`. Only payloads with the Cove magic count as Cove.

## Determinism

- State is a pure function of `(network, genesis height, canonical blocks, version)`.
- No timestamps, DB UUIDs, insertion order, or display addresses enter the root.
- Reorg = rebuild from the canonical chain; identical blocks → identical
  `computeStateRoot()`.
- All arithmetic is `BigInt`. No floats.

## Not proven by the indexer

- **Custody**: no keys, no signing server-side. Wallets sign the PSBT.
- **Mainnet**: all mainnet flags are `false`; mainnet genesis is `null`.
- **Confirmation depth**: applied at block; reorgs handled by deterministic rebuild.
- **Bitcoin enforcement**: see "Cove is CLIENT-VALIDATED" above — nothing in
  this document claims Bitcoin enforces Cove rules.

---

## Phase 4.4 — Guardian enforcement / Simplicity trust boundary (exact)

**BITCOIN ENFORCES:** canonical Bitcoin UTXO spending, holder signatures,
Taproot script-path commitment, revealed tapleaf/control-block validity,
Guardian CHECKSIG, CSV recovery, Bitcoin value conservation, double-spend
prevention.

**SIMPLICITY PRE-EXECUTION VALIDATES:** the invariants actually encoded in the V3
program (positive amount, supply conservation, no over/underflow, reserve/backing
movement). It does **not** implement the full geometric20 curve.

**REFERENCE COVE POLICY VALIDATES:** complete CoveStateV2 transition, geometric20
exact R-delta, token-UTXO semantics, output/payment/fee semantics.

**GUARDIAN:** executes both required policy layers and signs only after acceptance.

Bitcoin itself still does **not** execute Simplicity. CMR commitment does **not**
make Bitcoin independently validate Simplicity semantics. **Guardian compromise
remains a trust assumption.**
