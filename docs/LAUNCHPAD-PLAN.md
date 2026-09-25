# Making Cove a launchpad

Every claim here was verified against the code or against a real transaction,
not inferred. Citations are `file:line`. Where something was proven by running
it, the evidence is named.

---

## What is already true

The protocol core is real and it is the hard part. Keep all of it.

- **One curve function for both directions.** `grossBuy = R(s+q) − R(s)` and
  `grossRedeem = R(s) − R(s−q)` (`packages/cove-economics/src/backing.ts:85,96`).
  Buy and redeem are exact inverses; a round trip costs exactly
  `buyFee + redeemFee` plus miner fees. There is no sell-side spread.
- **The backing is real BTC in a real UTXO**, not an accounting number:
  `stateUtxo.value = backingSats + 10,000 anchor`, enforced on both the input
  and the successor (`packages/cove-guardian/src/v3/validate.ts:133,152,317`).
  Watched live on Mutinynet today: 10,000 → 59,350 sats across one 84M mint.
- **The vault cannot go insolvent.** Successor backing is recomputed from
  supply and never taken from the caller (`transitionV2.ts:110`); redeem
  conservation is checked (`validate.ts:392`); supply is capped
  (`transitionV2.ts:73`). Draining all supply returns the vault to R(0) = 0.
- **Full mint-out raises 24,196,788 sats = 0.24196788 BTC** across 20 stages of
  42M tokens each, 500 → 149,731 sats per million.
- **P2P settlement is genuinely atomic** — one Bitcoin transaction, both
  signatures, the backing vault untouched (`cove-market/src/finalize.ts:129`).
- **No premine, no creator allocation.** `CREATOR_PREMINE_TOKENS = 0n`
  (`packages/curve/src/constants.ts:24`). The launcher starts with nothing.

---

## What is false today

### P0-1 — The dust floor makes small buys and small sells impossible

The 1% protocol fee is its own output, and Bitcoin will not relay an output
below the dust limit. The Guardian therefore refuses any trade whose fee output
would be dust (`validate.ts:181,342`).

**Minimum viable trade: 29,301 sats of curve value.** At stage-1 pricing that is
**58,602,000 tokens — about 7% of the entire public supply — as a first
purchase.** Below that, no signature is issued.

The same floor blocks the sell side: a holder whose position is worth less than
~29,301 sats of R-delta **cannot redeem to the vault at all.**

Not theoretical. The Mutinynet proof run hit it today with a 1M-token mint:

```
PROTOCOL_FEE_DUST: fee 5 < dust 294; minimum gross 29301
```

**Fix:** accrue the fee inside the vault and sweep it periodically, or waive it
below a threshold. `feeBps == 0` is already an accepted case at dust-check time
(`cove-economics/src/feeSettlement.ts:36`), so the second option is small.

### P0-2 — The redeem builder has three real bugs

`packages/cove-app/src/service.ts:547-549`:

```ts
const sorted = [...mine].sort(/* ascending */);
const selected = sorted.filter((u) => u.amountAtoms >= 0n).slice(0, 4);
```

- **Large redemptions fail.** The balance check uses *every* UTXO
  (`service.ts:544`) but only the **four smallest** become inputs. A position
  spread over five or more UTXOs throws `redeem exceeds token input`
  (`builder.ts:362`). `buildTransfer` has the same shape (`service.ts:657`).
  The `.filter(u => u.amountAtoms >= 0n)` is a no-op — atoms are unsigned.
- **Partial redeem from a single UTXO is impossible.** Redeem has no BTC
  funder; the miner fee comes out of the seller's carriers
  (`builder.ts:405-410`). With one carrier and a partial redeem the arithmetic
  is `1000 − 1000 − 1000 = −1000` → `insufficient redeem funds`.
- **Redeem stops working above roughly 10 sat/vB.** Four carriers give a
  4,000-sat total fee budget against a ~300–400 vB script-path spend.

### P0-3 — One curve trade per token per block

The vault is a single chained UTXO. `loadBacking` reads only confirmed state
(`service.ts:222`), the v3 indexer has **no mempool ingestion** (verified by
grep across `packages/cove-indexer/src/v3/`), and a build whose vault outpoint
moved throws `QUOTE_STALE` (`service.ts:406`).

So the second buyer of a token in the same block silently loses. At any real
volume the token page becomes a lottery. **This is the largest gap between what
exists and a launchpad, and no amount of UI work fixes it** — it needs
mempool-chained vault states or a different vault topology.

### P0-4 — The 160M reserve does not exist

It is a constant and a line of UI copy. Verified: it is never minted
(`applyMintV2` only ever increments public supply and caps at 840M,
`transitionV2.ts:67-89`), there is **no reserve field in the 51-byte state
struct** (`cove-covenant/src/stateV2.ts:9-18`), and it appears in no wire
envelope (`cove-wire/src/codecV2.ts:102-119`). `packages/curve/src/liquidity.ts`
declares itself a simulator that is "NOT activated on mainnet".

The launch page tells every creator about a 160M reserve they can never touch.

---

## The capability gap versus crc.garden

Decoded from a real mainnet transaction
(`094a94456ddc0ec6707eb3a5a5199aeee828cb7e51234c346c9606fda70f37d9`, block
968540):

| | crc.garden | Cove |
|---|---|---|
| Order signing | `SIGHASH_SINGLE\|ANYONECANPAY` | `SIGHASH_ALL` only |
| Order book | free-floating offers, sweepable, several per tx | reserve → both sign → settle |
| Covenant | none — every input is a key-path spend | none — soft covenant |
| Envelope | 66 bytes of JSON | ~42 bytes of binary |
| Ledger | amount in OP_RETURN, implicit change | explicit per-UTXO allocation |

Their sellers sign only their own input and their own payout, so the fragment
sits on a book and any buyer can sweep several at once. That transaction filled
**two** independent sell orders in one go.

Cove **explicitly refuses this**: `cove-market/src/psbt.ts:49,55` rejects
ANYONECANPAY with `UNSAFE_SIGHASH`. The caution is legitimate —
`SIGHASH_SINGLE` has an index-matching footgun and ANYONECANPAY lets a taker
add inputs — but the cost is the order book, and with it the product's
liquidity story.

Neither protocol uses a Bitcoin covenant. There are none on mainnet. "Covenant
token protocol" describes the same soft model on both sides, and Cove's own
docs already say so honestly (`docs/COVE_COVENANT_ARCHITECTURE.md:7-19`).

---

## Plan

### Phase 0 — make the current pitch true (days)

1. Fix the fee-dust floor so a $5 buy and a small redeem both work.
2. Fix the three redeem bugs; give redeem a real BTC funder input.
3. Decide the 160M: implement it or delete it from the UI. Do not ship copy
   describing a reserve that no code can reach.
4. Chart the curve, not just P2P fills. Today a token that has never traded
   peer-to-peer shows an empty chart forever, even while its curve price moves.

### Phase 1 — throughput (the real work)

Make more than one curve trade per block possible. Options, in increasing order
of difficulty:

- **Chain in the mempool.** Let a build spend an unconfirmed successor. Needs
  mempool ingestion in the indexer and careful reorg handling.
- **Batch.** Collect buys within a block and settle them as one transition.
  Changes the UX from "instant" to "next block", but it is honest and simple.
- **Split the vault.** Multiple parallel backing UTXOs per token. Largest
  change; touches the state model and every proof.

Until this is solved, the product cannot carry volume.

### Phase 2 — the order book

Support `SIGHASH_SINGLE|ANYONECANPAY` listings behind the existing validation,
so offers float and a buyer can sweep several at once. This is what makes the
market page look like the screenshot rather than a reservation queue. It must
be built with the index-matching footgun handled explicitly and covered by
adversarial tests, not simply by relaxing `psbt.ts:55`.

### Phase 3 — launchpad surface

All of these have working backends and no frontend:

- holders list (`getTokenHolders`, no UI)
- real ask ladder (the token page passes demo listings only —
  `token/[tokenId]/page.tsx:261`)
- best-execution router (`best-execution.ts`, zero UI callers)
- token images (`imageUrl` is stored and validated, rendered nowhere)
- per-token activity (API exists, no page)

Genuinely absent and needed for the category: creator fee split, trending by
volume, a live new-launches feed, comments.

### Phase 4 — mainnet

Unchanged and unaffected by the above: the operator ceremony, a second Core, a
remote Guardian, durable custody and journal storage.
See `docs/MAINNET-CEREMONY.md`.

---

## The honest framing for users

The vault is a **backstop, not a price guarantee**. Redemption pays the curve
price for the *current* supply, not what any individual paid. If the token runs
up, early holders redeem into later buyers' money; if everyone leaves, the exit
walks back down the staircase and the last holder out receives 500 sats per
million.

At full mint the vault holds 0.242 BTC against a notional 1.258 BTC at the top
price — **the backing covers about 19% of notional at the peak.** That is normal
for a bonding curve and it is not what "fully backed" sounds like. Say it
plainly on the page.
