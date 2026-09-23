# Cove Backing

## What backing is

Every Cove token has a token-specific **Bitcoin backing reserve** (`backingSats`)
held in real satoshis. Primary-buy principal goes into that backing vault, NOT to
the creator. The backing provides an always-available deterministic redemption
path: a holder can always sell tokens back to backing without needing an external
buyer.

This is a **bonding/backing reserve**, not a pool-based DEX AMM. There are no LPs,
no LP tokens, no `x*y=k`, no paired inventory, no swap router. When Cove buys
tokens back from backing, it is economically acting as a market maker — that
distinction is stated plainly and never hidden.

## Where buyer BTC goes

- **Backing vault**: receives `grossCurveCost` (the curve principal).
- **Protocol fee output**: receives `buyFee` (separate; never from principal).
- **Creator**: receives nothing from backing principal.

## How redemption works

For issued public supply `s` and a redeem quantity `q`:

```
requiredBacking(s) = R(s)          (the geometric20 cumulative reserve function)
grossRedeem        = R(s) - R(s-q)
sellFee            = ceil(grossRedeem · redeemFeeBps / 10_000)
seller receives    = grossRedeem - sellFee
```

Redemption value is the **reverse movement through the same backing function** —
never derived from last trade, market cap, average price, a discount off the buy
price, or an external oracle. Redeemed units reduce issued supply and become
buyable again; a sold-out token therefore reopens capacity.

## Curve model

`R(s)` is the `geometric20` curve integral (frozen in Phase 3). Buy and redeem are
the forward and reverse R-deltas:

```
grossBuy = R(s+q) - R(s)
grossRedeem = R(s) - R(s-q)
```

Because both use the **same** R function, a buy→redeem round trip conserves
backing principal **exactly** (ignoring fees). With fees the user always ends with
less BTC than they started with.

## Fees

One central configuration (`@crclaunch/cove-economics` `COVE_FEE_CONFIG`):

- `buyFeeBps` = 100 (1.00%)
- `redeemFeeBps` = 100 (1.00%)
- `p2pFeeBps` = 50 (0.50%)

These are conservative **development defaults**; mainnet fee policy is explicit
configuration requiring freeze. Fees are deterministic integer (`ceil(gross·bps/10_000)`).
Backing principal is never a fee.

## Solvency invariant

```
actualBackingSats >= requiredBackingSats
```

On the normal exact path `actualBackingSats == requiredBackingSats`. Excess (only
via explicit donation) is accounted separately and never changes redemption
values. If `actualBackingSats < requiredBackingSats` the token is **unhealthy**:
the system refuses new operations that could worsen insolvency and surfaces a
health error.

## Trust model

- **Bitcoin enforces**: Taproot script paths, NUMS/no key-path, the 144-block CSV
  recovery leaf, CHECKSIG, and exact UTXO ownership/conservation.
- **Cove client/Guardian validates**: the Simplicity MINT/REDEEM predicates
  (pre-executed off-chain, real CMR-bound), the geometric20 economics, balances,
  and Guardian authorization. Bitcoin does not execute the Simplicity predicate.
- A single Guardian is a trust assumption; CMR binding does not remove Guardian
  trust. Guardian compromise could authorize invalid spends.

## Failure modes

`TOKEN_NOT_FOUND`, `INVALID_AMOUNT`, `PUBLIC_CAP_EXCEEDED`,
`INSUFFICIENT_TOKEN_BALANCE`, `INSUFFICIENT_BACKING`, `BACKING_INVARIANT_FAILED`,
`QUOTE_STALE`, `STATE_CHANGED`, `POLICY_MISMATCH`, `CMR_MISMATCH`,
`SIMPLICITY_REJECTED`, `DIFFERENTIAL_MISMATCH`, `GUARDIAN_REJECTED`,
`PSBT_MISMATCH`, `WIRE_PAYLOAD_TOO_LARGE`.
