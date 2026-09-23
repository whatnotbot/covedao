# Cove Market

## Two-layer model

1. **Cove Backing** — the deterministic issuance/redemption reserve (see
   `COVE_BACKING.md`). Always present, even with zero P2P listings.
2. **Peer-to-peer fixed-price market** — sellers list a fixed BTC asking price;
   buyers may take the listing or buy from backing, whichever is cheaper.

## User listings

A seller can either **Instant Sell** (redeem into Cove Backing immediately) or
**List for Sale** (fixed price, wait for a buyer).

Each listing is a signed, canonical, integer-only order:

```
listingId, orderVersion, tokenId, seller, amount,
totalPriceSats, expiry, nonce, sellerSignature, state/balance reference
```

`totalPriceSats` is the canonical price (integer). Unit price is derived for
display only — never the authoritative value.

## Interactive atomic PSBT fill (go-to-market)

The first production version favors correctness over noninteractive sighash
tricks:

1. Seller signs an off-chain listing.
2. Buyer clicks Buy.
3. Backend re-validates the listing (signature, token exists, amount > 0,
   totalPrice > 0, sufficient confirmed Cove balance, not stale, valid expiry,
   nonce unused, not over-listed), then reserves it briefly.
4. Backend builds ONE PSBT: buyer BTC funding + seller's Cove state input(s) +
   Cove TRANSFER to buyer + BTC payment to seller + optional Cove market fee +
   change + Cove metadata/state commitments.
5. Buyer signs their inputs.
6. Seller signs their inputs.
7. Full validation, then broadcast.
8. Indexer observes confirmation; the order is marked FILLED only from observed
   valid settlement.

BTC payment and Cove transfer happen in the **same transaction**. No backend
custody, no private-key upload, no "send BTC first, token later", no
database-only settlement. A seller must be online for the initial P2P MVP — which
is acceptable because every holder still has instant backing redemption. The
execution interface is designed so a future noninteractive pre-signed order
scheme can replace the interactive signer without changing orderbook/UI APIs.

## Cancellation & invalidation

Off-chain cancellation is a signed message (`seller`, `listingId`, order
hash/nonce, timestamp/height, signature) — not consensus. If the seller spends
the token balance elsewhere, the listing becomes `INVALIDATED` and is never shown
as executable.

## Best execution

For a BUY: compare active compatible user asks against the Cove Backing quote by
exact total sats, return sources cheapest-first. For a SELL: return the instant
backing redemption quote plus the ability to create a listing. A user listing is
never guaranteed to fill.

## Confirmation & reorg

Backing quotes bind to `(tokenId, stateHash, backingOutpoint, issuedSupply, side,
amount, gross, fee, resultingSupply, resultingBacking, expiry)`. A quote built
against state `S0` must not execute after a confirmed transition moves the token
to `S1` (errors: `QUOTE_STALE`, `STATE_CHANGED`, `BACKING_OUTPOINT_SPENT`).

Trades are not final merely because they appeared once. Every indexed block stores
height + block hash + previous hash; on mismatch the indexer rolls back events,
state, balances and trades above the common ancestor and replays the canonical
chain.

## Honest labeling

Backing redemptions and backing buys are labeled `BACKING_REDEEM` /
`BACKING_BUY`; P2P fills are labeled `P2P`. Backing is never presented as "P2P
liquidity". No fake orders, volume, holders, candles, or trades are manufactured.
