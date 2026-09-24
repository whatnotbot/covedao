# Cove Market

## Two-layer model

1. **Cove Backing** — the deterministic issuance/redemption reserve (see
   `COVE_BACKING.md`). Always present, even with zero P2P listings.
2. **Peer-to-peer fixed-price market** — sellers list a fixed BTC asking price;
   buyers may take the listing or buy from backing, whichever is cheaper.

A P2P fill is a plain Cove TRANSFER on chain — ordinary Bitcoin, no backing, no
Guardian signature, no supply movement. The marketplace is an **order
coordinator + best-execution layer** on top of the already-proven atomic
TRANSFER primitive, never a token authority.

## Frozen canonical listing (V1)

`MARKET_ORDER_VERSION = 1`, `MARKET_CANCEL_VERSION = 1`. A listing is an
endianness-frozen big-endian binary record (u8/u16/u32/u64, no JS property-order
dependence):

```
orderVersion(u8) chainIdentity(u16+utf8) tokenId(32) sellerTokenScript(u16+hex)
sellerPayoutScript(u16+hex) sellerTokenChangeScript(u16+hex) sourceTxid(32)
sourceVout(u32) sourceAmountAtoms(u64) amountAtoms(u64) totalPriceSats(u64)
creationHeight(u64) expiryHeight(u64) nonce(32)
```

```
listingId = TaggedHash("Cove/Market/Listing/v1", serializeListingV1(listing))
```

The seller authorizes the listing with **BIP-322** (simple variant,
`SHA256(message)` commitment) over `COVE_MARKET_LISTING_V1:<listingIdHex>`
against `sellerTokenScript`. Cancellation is a second BIP-322 signature over
`COVE_MARKET_CANCEL_V1:<cancelHashHex>` where
`cancelHash = TaggedHash("Cove/Market/Cancel/v1", canonicalBytes)`.

## V1 constraints (frozen)

- EXACTLY ONE source token UTXO per listing (`sellerTokenChangeScript ==
  sellerTokenScript` required).
- All-or-none: the full listed `amountAtoms` moves; no partial fill, no
  multi-source, no bid orderbook, no noninteractive `ANYONECANPAY`.

## Fee semantics (frozen)

- `totalPriceSats` is the **exact** BTC the seller receives — never reduced by a
  fee.
- The buyer pays `totalPriceSats + p2pFee + extraCarrierSats + minerFeeSats`,
  where `p2pFee = deterministicFee(totalPriceSats, p2pFeeBps)`, `extraCarrier`
  is the additional token-carrier dust the buyer funds beyond the source
  carrier, and `minerFeeSats` is the exact miner fee (≤ `maxMinerFeeSats`).
- Payout and fee outputs must clear relay dust (`SELLER_PAYOUT_DUST` /
  `MARKET_FEE_DUST`), all bigint-only.

## Lifecycle

Listing: `ACTIVE → RESERVED → BROADCAST → FILLED`; side transitions to
`CANCELLED` (signed, never resurrects), `EXPIRED`, `INVALIDATED` (source spent
externally), `REORGED`.

Fill: `RESERVED → PSBT_BUILT → BUYER_SIGNED → SELLER_SIGNED → BROADCAST →
CONFIRMED`; side transitions to `EXPIRED`, `CANCELLED`, `FAILED`, `REORGED`.

## Interactive atomic PSBT fill (go-to-market)

1. Seller signs an off-chain listing.
2. Buyer reserves (health-gated, `SELECT … FOR UPDATE`); the source outpoint is
   re-resolved from the canonical V3 DB + Core `gettxout`.
3. Backend builds ONE PSBT (`buildTransferPsbtV2`): seller's source token input
   + buyer BTC inputs → buyer token carrier (+ seller change carrier) + exact
   seller payout + p2p fee + buyer change.
4. Buyer signs only their BTC inputs; seller signs only the token input. The
   unsigned-tx digest must be byte-identical across stages; `ANYONECANPAY` /
   `SINGLE` / `NONE` sighashes are rejected.
5. `finalizeP2PFill` → `validateFinalizedP2PFill` (market semantics on
   `validateFinalizedTransferTransaction`: no backing spend, exact payouts/fee/
   miner-fee, dust-safe, exact allocations) → opaque `ValidatedP2PFill`.
6. `broadcastValidatedP2PFill` (testmempoolaccept → sendrawtransaction).
7. `reconcileMarket` marks `CONFIRMED` / `FILLED` only from the indexer's
   observed settlement — never at broadcast.

BTC payment and Cove transfer happen in the **same transaction**. No backend
custody, no private-key upload, no "send BTC first, token later", no
database-only settlement.

## Off-chain market state

Market rows live in `cove_v3_market_listings`, `_listing_inputs`, `_fills`,
`_cancellations`, `_trades`, `_events`. They are **off-chain application
state** — never part of the `Cove/IndexerState/v3` root, and they survive a
full indexer reindex. Inventory is always resolved from `cove_v3_token_utxos` +
Core; market rows are never token authority.

## Best execution

`getBuyRoutes(tokenId, amountAtoms)` compares the P2P exact protocol cost
(`sellerPrice + marketFee`) against the backing cost (`grossBuy + buyFee`),
cheapest-first, bigint-only, read-only (never reserves/signs/broadcasts).
`getSellOptions` returns the backing instant-redeem quote plus the owner's
listable token UTXOs.

## Confirmation & reorg

Only indexer-confirmed transfers become `CONFIRMED` trades. On reorg a confirmed
trade is flipped `canonical=false`, the fill and listing become `REORGED`, and
reconcile restores the listing to `ACTIVE` (if the source is again unspent),
`INVALIDATED` (spent by someone else), or `EXPIRED`. A cancelled listing never
resurrects.

## Security / trust model

- **No custody.** The market never holds seller or buyer private keys, and never
  takes ownership of tokens or BTC at any step.
- **No "send first".** Token transfer and BTC payment settle atomically in one
  transaction; there is no window where one party is exposed.
- **No DB-only settlement.** DB rows describe orders and observed settlement;
  they can never create or destroy tokens. Authority is the indexer's canonical
  view + Core.
- **Inventory re-resolved every step.** Activation, reserve, PSBT-build,
  seller-sign, and broadcast all re-check the source outpoint against the V3 DB
  and Core `gettxout`, so mempool/external spends are caught before confirmation.
- **Backing/Guardian untouched.** A P2P fill never spends the backing UTXO and
  never changes supply; final validation asserts this explicitly.
- **Opaque broadcast boundary.** Only `validateFinalizedP2PFill` can construct a
  `ValidatedP2PFill`; only `broadcastValidatedP2PFill` accepts one. Mainnet is
  refused.

## V1 limitations

- One source token UTXO per listing; all-or-none; no partial fill, no bid
  orderbook, no multi-ask aggregation.
- Interactive: the seller must be online to sign the token input (acceptable
  because every holder still has instant backing redemption).
- P2WPKH BIP-322 seller authorization only; P2TR key-path BIP-322 is a
  documented follow-up.
- The market fee destination is the shared Cove fee script; no per-listing fee
  override.
- Mainnet NOT READY — regtest/signet/testnet only this phase.

## Honest labeling

Backing redemptions and backing buys are labeled `BACKING_REDEEM` /
`BACKING_BUY`; P2P fills are labeled `P2P`. Backing is never presented as "P2P
liquidity". No fake orders, volume, holders, candles, or trades are manufactured.

## Final forensic report

Implemented in `@crclaunch/cove-market` (V3-native): canonical signed listings
(serialization/hash/BIP-322), off-chain market tables in `@crclaunch/db`, the
full `MarketService` state machine, unsigned-tx-digest mutation detection,
`validateFinalizedP2PFill` + opaque `ValidatedP2PFill` + hardened broadcast,
bigint-only best-execution quotes, and the market health gate. Proven by 16
local unit tests (golden listingId vector, BIP-322 roundtrip, digest mutation,
finalize mutation matrix) plus a `market-regtest` integration proof
(DEPLOY→MINT→list→reserve→build→sign→finalize→broadcast→confirm partial fill,
best execution, external source-spend invalidation, market rows surviving
reindex, and a confirmed-fill reorg) gated by
`.github/workflows/cove-v3-market.yml` on Postgres + Bitcoin Core 28.1 +
Simplicity. Phase 7/8 remain future work.
