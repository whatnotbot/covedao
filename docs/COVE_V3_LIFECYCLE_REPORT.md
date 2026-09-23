# Cove V3 — Transaction Reality Gate (Phase 4.3)

**Status: GATE PASSED (regtest only). Mainnet: NOT READY.**

This report is the §39-style, brutally-honest go/no-go for Phase 4.3. The single
purpose of this phase was to prove that the frozen Cove V2/V3 protocol executes
as **real Bitcoin transactions on unmodified Bitcoin Core regtest** — not as
off-chain state machines, not as mocked PSBTs. The phase is complete only when
ONE coherent lifecycle runs end-to-end on a live `bitcoind`.

It does. The full lifecycle below ran to completion on Bitcoin Core 28.1
`-regtest` with every transaction accepted by `testmempoolaccept` (`allowed=true`)
and broadcast.

---

## 1. The coherent lifecycle (one chain, one token)

Token identity (precomputable, NOT the deploy txid): **FROG**, nonce `0xab`,
policy V3, regtest chain identity.

```
tokenId = 4710488a0ab304fb2316e0174360a41937e1f0a81f2b26dee5a38ef79fb2d252
```

| # | Step | txid | height | testmempoolaccept |
|---|------|------|--------|-------------------|
| 1 | DEPLOY (S0 vault, anchor 10,000 sats) | `c30b7af2ff799a612cdae974cfa6a5c818fcae564c24709e6fa739b84004d23e` | 1 | allowed=true |
| 2 | MINT/BUY 84M tokens (Alice) | `8155dca9508093a2de08c1d4bbd80d69804b1d245f76adeeb1f32ef40084aa51` | 2 | allowed=true |
| 3 | TRANSFER 84M (Alice → Bob) | `5ee3eec887091d364dc422822ee85782ecae869696a8feddcbd606de292859e7` | 3 | allowed=true |
| 4 | REDEEM 84M (Bob, full) | `3462fcde5859ecc69e4ca38b51f680d776d051a4b92b46482955e02b69e32266` | 4 | allowed=true |
| 5 | RE-BUY 84M released capacity (Alice) | `07ab332fd200ef5eedfcbedb1f8c0a166cbd3bfb2e7a229b5b62824b266f58e9` | 5 | allowed=true |
| 6 | P2P atomic fill 42M for 100,000 sats (Alice → Carol) | `1e9313bf29ddc6c5d0fb124e13e40be38d5065df2cad6b866f7eff4ab93121e8` | 6 | allowed=true |

Reorg/replay: invalidated tip `36be6e46cc8d32f4…` → re-mined `0fca1fe604227afc…`
(different block hash, same P2P txid re-confirmed). Rebuilding a fresh
`CoveChainView` from the raw tx hex **only** reproduced the identical final
state (supply `8400000000000000` atoms, backing `49,350` sats, aggregate token
balance `8400000000000000` atoms).

### Backing lineage (single canonical R)

| State | supply (atoms) | backing (sats) | how reached |
|-------|-----------------|----------------|-------------|
| S0 | 0 | 0 | DEPLOY |
| S1 | 84,000,000,000,000 | 49,350 = R(84M) | MINT (gross 49,350, fee 494) |
| S1 | 84,000,000,000,000 | 49,350 | TRANSFER (untouched) |
| S0 | 0 | 0 | REDEEM (gross 49,350, fee 494, net 48,856) |
| S1 | 84,000,000,000,000 | 49,350 | RE-BUY (gross 49,350, fee 494) |
| S1 | 84,000,000,000,000 | 49,350 | P2P (untouched) |

### Token lineage (resolver-driven, from actual outpoints)

- MINT → Alice carrier 84M (`8155dca9…:2`)
- TRANSFER → Bob carrier 84M (`5ee3eec8…:1`); Alice's carrier spent
- REDEEM → Bob's carrier spent, supply→0, **no change carrier** (full redeem)
- RE-BUY → Alice carrier 84M (`07ab332f…:2`)
- P2P → Carol carrier 42M (`1e9313bf…:1`) + Alice change 42M (`1e9313bf…:2`)

Final balances: Carol 42M, Alice 42M, Bob 0. Backing 49,350 sats (R(84M)).

---

## 2. What is actually proven on-chain (not just in unit tests)

1. **DEPLOY** — a real OP_RETURN wire-v2 DEPLOY + a P2TR S0 backing vault
   (NUMS internal key, 3-leaf MAST: MINT/REDEEM/recovery) with the tokenId
   derived pre-transaction (never the txid).
2. **MINT/BUY** — a script-path spend of the MINT execution leaf
   (`<policyIdentityHash> OP_EQUALVERIFY <guardian> OP_CHECKSIG`) that moves the
   backing vault S0→S1 and pays a buyer token carrier. Succeeds on unmodified
   Core.
3. **TRANSFER** — ordinary Bitcoin (no Guardian, no backing movement): a token
   carrier UTXO is spent into a new carrier + the wire-v2 TRANSFER allocation.
   Backing/supply provably unchanged.
4. **REDEEM** — script-path spend of the REDEEM execution leaf, moves the vault
   S1→S0, pays the seller `net = gross − fee`, and burns the token input.
5. **RE-BUY** — the redeemed capacity is genuinely released and re-buyable (a
   second MINT from S0 succeeds at the same R-delta).
6. **P2P atomic fill** — ONE transaction that spends the seller's token carrier
   AND the buyer's BTC, creating the buyer's token carrier, the seller's BTC
   payment, and the 50 bps marketplace fee. Atomic (single tx), off-backing.
7. **Reorg/replay** — `invalidateblock` + re-mine produces a different tip, the
   P2P tx re-confirms with the same txid, and a deterministic replay from raw
   hex rebuilds identical state.

---

## 3. Adversarial refusal (fail-closed) coverage

The following non-canonical/illegal inputs are deterministically **refused** at
the resolver + transition + wire layers (unit-test verified; the wire layer is
also exercised on the real chain because every broadcast tx round-trips through
`decodeV2`):

- `CoveChainView` (5 tests): duplicate tokenId deploy, stale backing outpoint,
  mixed-token input, double-spend of a spent token outpoint, token inputs
  resolved **only** from actual tx inputs (never caller claims).
- `transitionV2` (10 tests): corrupted backing, corrupted curve stage, wrong
  policy version, zero tokenId, over-cap supply, `ECONOMIC_DUST`, plus the
  random BUY/REDEEM invariant `backing == R(supply)`.
- `codecV2` (23 tests): bad magic/version/opcode, non-canonical ticker, zero
  amount/tokenId, duplicate vout, allocation-sum overflow, trailing bytes,
  length mismatches.
- `tokenUtxo` (12) + `redeem` (5): token conservation and redeem accounting.

Full suite: **424 tests green** across 10 packages (exit 0), including the
Simplicity ↔ TypeScript differential (18 tests) that pins the real Simplicity
programs to the TS oracle.

---

## 4. Go / no-go (brutally honest)

### GO — for what this phase was scoped to prove

- The **transaction reality gate is met**: the frozen Cove V2/V3 protocol
  executes as real Bitcoin transactions on unmodified Bitcoin Core regtest.
- The vault is NUMS/script-path with the guardian CHECKSIG binding actual
  outputs; MINT and REDEEM spends both succeed on-chain.
- Backing is recomputed as `R(nextSupply)` from the single canonical R; it is
  never caller-supplied, and TRANSFER/P2P provably never move it.
- Reorg/replay is deterministic.

### NO-GO — for anything beyond this gate

- **Simplicity is NOT yet in the signing path.** The lifecycle's Guardian
  currently pre-executes the transition via the TypeScript reference
  (`applyMintV2`/`applyRedeemV2`). The real Simplicity programs + their frozen
  CMRs are only checked in the `cove-simplicity` differential test suite, not
  invoked by the signer at signing time. A Guardian that signs without first
  executing the real Simplicity program would be trusting a reimplementation,
  not the CMR-committed program. This is the single most important remaining
  item and it is **unfinished**.
- There is **no dedicated `validateAndSignMint/RedeemTransition` module** with a
  full validation sequence + audit record; signing is currently inlined in the
  harness and there is no `validateMintPsbtV3`/`validateRedeemPsbtV3`/
  `validateTransferTxV2`/`validateFinalizedCoveTransaction` revalidation layer.
- **No DB indexer, no marketplace API, no product UI, no mainnet deployment.**
  (All explicitly out of scope for this phase.)
- Fee-dust economics are **unhandled in the product path**: a 1% fee on small
  transitions is below P2WPKH dust (294 sats). The lifecycle works around this
  by using 84M-token transitions (fee 494 sats); a real product needs an
  explicit minimum/accumulation policy.

**Verdict: the transaction-reality gate is PASSED; mainnet remains NOT READY.**
Do not proceed to indexer/orderbook/API/UI off the back of this proof alone —
the Simplicity-in-signing-path gap must close first.

---

## 5. Frozen facts — unchanged (verified against golden values)

- `cove-20` protocol id; DEPLOY `0x01` / TRANSFER `0x02` / MINT `0x03` /
  REDEEM `0x04`.
- MINT V3 CMR `0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377`.
- REDEEM V3 CMR `37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56`.
- Golden regtest FROG/nonce`0xab` tokenId `4710488a…d252` (matched at deploy).
- geometric20 curve; public 840M / total 1B / reserve 160M.
- Production = wire v2, `CoveStateV2`, policy V3.
