# Protocol Verification Status

This file records the verification status of every mainnet (CRC-20 / PRECOP)
transaction path, based on the forensics phase (code + transaction evidence +
local reproduction). **No mainnet adapter method returns a transaction unless
its operation is `VERIFIED` here.** The mainnet adapter (`PrecopCRCAdapter`)
enforces this automatically.

Status taxonomy:

- **VERIFIED** — confirmed from public code AND a real mainnet transaction; a
  regression fixture exists.
- **PARTIALLY VERIFIED** — the on-chain *format* is confirmed, but the
  *validation rules* (indexer behavior) are not independently reproducible.
- **UNVERIFIED** — not yet confirmed from code + transactions.
- **UNSUPPORTED** — the protocol does not currently provide this path on Bitcoin
  mainnet (e.g. requires Simplicity, which is not active on Bitcoin).

## Headline determination

CRC-20 (the protocol behind crc.garden / $leaf) is a **client-side (indexer)
validated** Ordinals-style meta-protocol — *not* Bitcoin-consensus enforced. Its
whitepaper/yellowpaper describe a future Simplicity-covenant model, but that
model is **not live on Bitcoin mainnet** (Simplicity is only active on Liquid).
The papers state the current phase is the **Bootstrap Phase**: *"Security relies
on the reputation of the Oracle."* Therefore Bitcoin does **not** independently
reject an invalid CRC-20 mint/deploy/transfer, and the authoritative indexer is
closed-source. This alone prevents enabling any mainnet write.

## Status summary

| Operation          | Status              |
|--------------------|---------------------|
| DEPLOY             | UNVERIFIED          |
| MINT               | UNVERIFIED          |
| TRANSFER (format)  | PARTIALLY VERIFIED  |
| TRANSFER (write)   | UNVERIFIED          |
| DEX ASK            | UNSUPPORTED         |
| DEX BID            | UNSUPPORTED         |
| CANCEL             | UNSUPPORTED         |
| GRADUATION         | UNSUPPORTED         |
| 20-stage curve     | UNSUPPORTED (app-side only) |

## DEPLOY — UNVERIFIED

- **Status:** UNVERIFIED.
- **Source:** no public deploy validator found. `precop-node` has no deploy state
  machine; `brc20_standard.simf` is an unexecuted Simfony sketch.
- **Live tx:** the $leaf deploy tx could not be retrieved (crc.garden API returns
  502; no public indexer; no archive). The deploy JSON is therefore not
  confirmed. The yellowpaper signals that deploy uses `max=0` / `lim=0` to mark
  supply as "covenant-governed" (interpreted by an off-chain indexer).
- **Conclusion:** deploy format and validation rules are not reproducible.

## MINT — UNVERIFIED

- **Status:** UNVERIFIED.
- **Source:** no public mint validator. The `precop-node` "Queen's Seal" check is
  a hardcoded script-hash on the *wrong output index* and does not match the live
  $leaf treasury (proof below).
- **Pricing:** the protocol does **not** enforce `requiredPayment =
  f(currentSupply, requestedMintAmount)` on Bitcoin. Any pricing is
  application/indexer convention. Evidence: (1) client-validated + trusted
  Oracle per the papers; (2) `precop-node` contains no price/supply curve logic;
  (3) the live fee is a flat ~1337-sat treasury fee (per yellowpaper and observed
  transfers), not a percentage curve.

## TRANSFER — PARTIALLY VERIFIED (format only)

Confirmed from a real mainnet transaction:

```text
txid   e0b7e317a6311432bd3f03e9f8536b4dfed0625ddf5b96f5b1c6bc25bdb8ee2f
block  968175
OP_RETURN (vout[0]): {"p":"crc-20","op":"transfer","tick":"LEAF","amt":"10000000000000"}
vout[1]: recipient dust P2WPKH (294 sats)  bc1qyztrfnc86g5hpcmn4k8j0ztufxre7q5k3ajxzs
vout[2]: treasury fee  P2TR (1347 sats)    bc1pv85mk7dh9ea4ylsamzvcwsseglj7smph8rm8hz8ksxg4d5q43u8selta0j
vout[3]: change P2WPKH
amounts: 8 decimals (1 LEAF = 100,000,000 atoms)
```

- **Ownership model:** indexer-tracked (recipient = owner of vout[1] dust output;
  not encoded in the JSON).
- **Double-spend prevention:** application-level (indexer), not Bitcoin-script.
- **Regression fixture:** `packages/protocol/src/crc20.test.ts` (decode only).
- The *write* path remains UNVERIFIED (no reproducible indexer).

## DEX ASK / BID / CANCEL — UNSUPPORTED

- The yellowpaper describes an ask/bid/cancel flow (3% treasury fee, 144-block
  CSV refund path) but only inside the Simplicity-covenant model, which is not
  active on Bitcoin mainnet. crc.garden's market page shows **no trades**.
- No public transaction-construction/validation path exists on mainnet.

## GRADUATION — UNSUPPORTED

- No protocol-level graduation/amm primitive on mainnet. The reserve described by
  PRECOP is an aspirational covenant vault.

## Vault / reserve — NOT Bitcoin-enforced

- The observed $leaf treasury output is a **single-key P2TR**
  (`5120 61e9bb79…`), i.e. key-path-only Taproot, **indistinguishable from a
  normal single-signer wallet**. There is no on-chain script proving a lock,
  timelock, or spending condition. The papers admit (whitepaper): *"locking BTC
  into a vault remains indistinguishable from a standard P2TR single-key transfer
  to external observers."*
- Any "lock 2,100 blocks" or "covenant vault" semantics are client/indexer
  convention, not independently verifiable from Bitcoin script.

## Proof that precop-node ≠ live CRC-20

`precop-node` `harvester-worker.ts` requires `vouts[1].spk_hash == 6eb49dcd…`
for `universal_dex`. For the real LEAF transfer:

```text
sha256(live treasury spk) = 81efb683c17ad5ff0d137c2ba3313b5afc6f8658342e9319cbe02e7cee1a1b03
precop-node Queen's Seal   = 6eb49dcd3ab136a260ab0f916847ea40d5fb996cf7429adb7bfc0d93290e2fef
MATCH = false
```

And `precop-node` checks output index 1, while the live treasury is at output
index 2. The `precop-node` state-manager vault (`bc1ptekew…`) also differs from
the live vault (`bc1pv85mk…`). Conclusion: `precop-node` would **reject** the
actual live LEAF transactions, and its Simfony contracts are never executed.

## What must change before any mainnet write

1. A reproducible, open-source CRC-20 indexer whose deploy/mint/transfer rules
   match canonical crc.garden state (local replay == canonical state).
2. Bitcoin-consensus or otherwise independently verifiable rejection of invalid
   transactions (underpayment, over-mint, replay, wrong vault, wrong ticker).
3. The specific deploy/mint transaction format (still unconfirmed above).

Until then: **all mainnet write flags remain `false`**, and
`PrecopCRCAdapter` continues to throw `PROTOCOL_NOT_VERIFIED` for every build.
