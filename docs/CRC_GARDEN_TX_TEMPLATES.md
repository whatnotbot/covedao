# CRC.garden Transaction Templates

> Derived **ON_CHAIN_VERIFIED** from the decoded mainnet transactions (see
> `CRC_GARDEN_FORENSICS.md`). Field names are taken from the observed OP_RETURN
> JSON. These are **discovery/signaling envelopes**, not an
> indexer-authoritative balance ledger.

## Protocol discriminants
- `{"p":"crc-20", …}` — CRC-20 protocol.
- `{"p":"ico-20", …}` — ICO-20 protocol (transfer).

## DEPLOY (`crc-20` `op:"deploy"`)

Observed: `546cc042…` (block 967485).

```
input 0        P2TR (key-path, 64B Schnorr)         value 210,000
───
output 0        OP_RETURN (0 sats)  {"p":"crc-20","op":"deploy","tick":"LEAF",
                "type":"bonding","max":"100000000","lim":"2100000000",
                "leaf":"1","ordi":"286","btc":"3333333"}
output 1        P2WPKH change                       value 208,760
───
fee            1,240 sats      nLockTime 0         version 2
```

## MINT (`crc-20` `op:"mint"`) — observed as part of a combined transfer+mint

Observed: `394bdb53…` (block 967930), 1 input → 6 outputs.

```
input 0        P2TR (key-path)                      value 859,755
───
output 0        OP_RETURN (0 sats)  {"p":"ico-20","op":"transfer","tick":"LEAF","amt":"163000"}
output 1        P2PKH dust                          value 546
output 2        OP_RETURN (0 sats)  {"p":"crc-20","op":"mint","tick":"LEAF"}
output 3        P2TR creator-dust                   value 330
output 4        P2TR reserve/vault anchor           value 10,000
output 5        P2TR change (== input script)       value 847,994
───
fee            885 sats       nLockTime 0          version 2
```

Observed envelope shapes (field names verbatim):

- DEPLOY: `op`, `tick`, `type` (`bonding`), `max`, `lim`, `leaf`, `ordi`, `btc`.
- MINT: `op`, `tick`.
- TRANSFER (`ico-20`): `op`, `tick`, `amt`.

## TRANSFER (`ico-20` `op:"transfer"`)

Observed as `output 0` of `394bdb53…`:
`{"p":"ico-20","op":"transfer","tick":"LEAF","amt":"163000"}` — a zero-value
OP_RETURN carrying `amt` in (integer) token units.

## Layout observations (facts, not claims)

1. OP_RETURN envelope is always **output 0** and **0 sats** (matches PRECOP's
   documented "Command-First" topology).
2. The CRC actor spends via **key-path P2TR** (single Schnorr witness), not a
   revealed MAST/script path.
3. A persistent P2TR `5120bf39…c79f` appears as deploy input and again as the
   mint's reserve anchor output — the protocol's reserve UTXO.
4. Dust outputs (546 P2PKH, 330 P2TR) are used as recipient/creator anchors.
5. Change goes to the same P2TR script as the input (`f002…aa335`).

## What these templates do NOT establish

- No NUMS/MAST/CSV vault is revealed by these transactions (all key-path).
- No indexer-authoritative balance semantics are encoded on-chain; the OP_RETURN
  JSON is metadata. Balance interpretation requires an off-chain indexer (which
  Cove must **not** treat as the authority).
