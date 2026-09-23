# Cove Trust Model — Validate, Never Trust

This document defines what the Cove validator/indexer trusts and what it treats
as adversarial input. The invariant is:

> **A transaction builder, frontend, API caller, and the OP_RETURN payload are
> all untrusted.** The deterministic validator/indexer independently derives
> validity from canonical state + signer/ownership + outputs + rules.

---

## Canonical facts (trusted)

Only these are treated as ground truth:

| Fact     | Source                                             |
| -------- | -------------------------------------------------- |
| Chain    | Canonical Bitcoin signet blocks, in order          |
| Ownership| Input 0's spent-UTXO `scriptPubKey` (Bitcoin-enforced signature) |
| Outputs  | The exact vout layout + satoshi values in the tx   |
| Rules    | The canonical curve, fees, and layout, recomputed locally |

## Adversarial claims (untrusted, verified)

Everything the client/payload asserts is re-derived or checked:

| Claim                 | How it is checked                                                |
| --------------------- | ---------------------------------------------------------------- |
| "I am actor X"        | Derived from input 0's spent UTXO scriptPubKey, not from JSON    |
| "send to recipient Y" | Derived from vout 1's scriptPubKey, not from JSON                |
| `amt`, `s` (supply)   | Cross-checked against canonical state and the recomputed curve    |
| curve/fee sats        | Recomputed from the curve; the vout 2/3 amounts must match **exactly** |
| ticker uniqueness     | Enforced against canonical ticker index (first deploy wins)       |
| balance sufficiency   | Enforced against canonical balances (available = balance − locked) |

## Attack classes rejected

| Attack                                | Rejection                                       |
| ------------------------------------- | ----------------------------------------------- |
| Forged `from`/`to` in JSON             | Ownership derived from Bitcoin, JSON has no authority |
| Overpay/underpay curve or fee          | Exact-output match required (`UNDERPAYMENT`/`OVERPAYMENT`) |
| Stale supply (`s` ≠ confirmed)         | `STALE_SUPPLY`                                   |
| Mint beyond public supply              | `OVERMINT`                                       |
| Unknown ticker/deployment              | `UNKNOWN_DEPLOYMENT`                             |
| Self-transfer                         | `SELF_TRANSFER`                                  |
| Transfer exceeding available balance   | `INSUFFICIENT_AVAILABLE_TOKENS`                  |
| Non-P2WPKH/P2TR actor or recipient     | `UNSUPPORTED_ACTOR_SCRIPT` / `INVALID_RECIPIENT` |
| Malformed/duplicate/oversized envelope | parser rejection (`MALFORMED_JSON`, `DUPLICATE_KEYS`, `OVERSIZED_PAYLOAD`, …) |
| Wrong treasury/reserve script          | `WRONG_TREASURY` / `WRONG_RESERVE`               |

## Determinism guarantees

- State is a pure function of `(network, genesis height, canonical blocks, version)`.
- No timestamps, DB UUIDs, or insertion order enter the state root.
- Reorg = rebuild from the canonical chain; identical blocks → identical
  `computeStateRoot()`. Verified by the indexer's replay/reorg tests.
- Economics use `BigInt` only; the canonical 20-stage price table is never
  recomputed from a float.

## Boundary: what is NOT proven by the indexer

- **Custody**: the indexer never holds keys and never signs. Wallets sign the
  PSBT client-side; the indexer decodes and validates the signed transaction.
- **Mainnet**: all mainnet write flags remain `false`. Signet only, read-only
  indexing against the public signet RPC.
- **Confirmation depth**: a tx is applied at its block; reorgs are handled by
  deterministic rebuild, not by trusting a provider's "confirmed" flag.
