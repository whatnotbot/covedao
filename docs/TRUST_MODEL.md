# Cove Trust Model — V3 (production)

This is the canonical architecture reference for the production Cove V3
protocol: wire V2, `CoveStateV2`, policy V3, geometric20 backing `R(s)`,
token-UTXO ownership, and the NUMS/3-leaf V3 MAST with CMR-bound Simplicity
pre-execution.

> **A transaction builder, frontend, API caller, wallet, and every OP_RETURN
> payload are untrusted.** Validity is derived ONLY from canonical Bitcoin
> blocks + frozen protocol rules + the canonical previous state. Nothing in
> this document claims Bitcoin enforces Cove rules.

The legacy V1/indexer-authoritative model lives at
`docs/legacy/COVE_V1_TRUST_MODEL.md` and is **not** production.

---

## What BITCOIN enforces

- canonical transaction ordering (block height ASC, tx index ASC)
- Bitcoin UTXO ownership (holder signatures)
- Taproot script-path commitment, revealed tapleaf/control-block validity
- the Guardian `OP_CHECKSIG` in the execution leaf
- `OP_CHECKSEQUENCEVERIFY` recovery timelock
- Bitcoin value conservation (no inflation)
- double-spend prevention

Bitcoin does **not** execute Simplicity and does **not** validate any Cove rule.

---

## What Cove V3 validates (deterministic client validation)

- **token identity** — precomputable, domain-separated `tokenId`
  (`H_CoveToken(chainIdentity ‖ policyVersion ‖ ticker ‖ nonce)`); the ticker is
  presentation metadata only, never an authority.
- **token-UTXO lineage** — ownership is the set of unspent token UTXOs created
  by valid DEPLOY/MINT/TRANSFER/REDEEM transitions; balances are derived
  (`SUM(unspent token UTXOs)`), never an authoritative account counter.
- **CoveStateV2** — `issuedPublicSupplyAtoms`, `backingSats == R(supply)`,
  `curveStage`, all recomputed from the canonical V2 transition.
- **backing** — the single canonical reserve function `R(s)` over `geometric20`;
  MINT `R(s+q) − R(s)`, REDEEM `R(s) − R(s−q)`; backing never funds carriers or
  miner fees.
- **wire V2** — canonical binary envelope (magic `CV`, version 2, opcode,
  tokenId/amount/allocations); malformed wire is recorded `INVALID` and never
  mutates state.
- **V3 MAST** — NUMS internal key + MINT/REDEEM/recovery leaves; the policy
  identity hash binds `(version, op, tokenId, currentStateHash, CMR)`.
- **CMR-bound Simplicity pre-execution** — the Guardian executes the REAL
  compiled Simplicity predicate and requires its CMR to equal the frozen V3 CMR.

---

## What SIMPLICITY pre-execution validates

The invariants actually encoded in the V3 program:

- MINT: positive amount, supply conservation, no u64 overflow, public cap,
  reserve movement.
- REDEEM: positive amount, no underflow, supply conservation, backing movement.

It does **not** implement the full geometric20 curve. Simplicity PASS is
**not** by itself a complete Cove transition.

---

## What the REFERENCE Cove policy validates (TypeScript)

- complete `CoveStateV2` transition (`applyMintV2` / `applyRedeemV2`)
- geometric20 exact R-delta (curve-exactness is TS-only)
- token-UTXO semantics
- output/payment/fee semantics (successor vault, carrier, payout, protocol fee,
  miner-fee bound, fee-dust standardness)

---

## The Guardian

- executes **both** required policy layers (Simplicity + full reference)
- verifies the compiled CMR against the frozen V3 CMR
- signs (BIP341 script-path) **only after acceptance**
- holds the signing key privately; the harness cannot sign backing inputs itself

**Guardian compromise remains a trust assumption.** Bitcoin does not execute
Simplicity; the CMR commitment does not make Bitcoin independently validate
Simplicity semantics.

---

## The indexer

- a deterministic replay/cache/persistence layer over canonical Bitcoin blocks
- NOT the source of ownership
- NOT allowed to invent balances (balances are derived from token UTXOs)
- records invalid Cove-looking transactions but never applies them to state

## The database

- a disposable projection, fully rebuildable from Bitcoin
- never authoritative over Bitcoin
- application metadata (descriptions/images) links to the stable `tokenId` and
  survives reindex; the chain projection does not.
