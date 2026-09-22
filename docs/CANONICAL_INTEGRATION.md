# Canonical Integration Design

How CRC Launch plugs into the canonical CRC Oracle/indexer. This is the
**proposed** integration contract — not a description of the current CRC API.

## Oracle authorization flow

```text
        user
         │  1. fill launch/mint form
         ▼
   CRC Launch (web)
         │  2. request canonical authorization
         ▼
   Canonical CRC Oracle / API
         │  3. signed/authorized operation
         ▼
   CRC Launch
         │  4. build Bitcoin tx / PSBT
         ▼
   user's wallet (signs)
         │  5. broadcast signed Bitcoin tx
         ▼
   Bitcoin mempool → block
         │
         ▼
   Canonical CRC indexer
         │  6. accepted / rejected (canonical state)
         ▼
   CRC Launch (reads canonical state)
```

## Trust boundary (invariant)

1. The Oracle **never** receives the user's private key.
2. The user's wallet signs **only** the Bitcoin transaction (destination, amount,
   fees shown before signing).
3. CRC Launch never holds or forwards a private key, seed phrase, or signed
   authorization that could move funds without the user's signature.
4. The canonical indexer — not CRC Launch — decides whether an operation is
   canonical. CRC Launch's database is only a projection of that state.

## Provider seam

All canonical behavior goes through `CanonicalCRCProvider`
(`packages/protocol/src/canonical.ts`):

| Method | Purpose |
|---|---|
| `getCapabilities()` | feature negotiation (UI adapts automatically) |
| `validateTicker()` | canonical ticker rule + availability |
| `requestDeploymentAuthorization()` | Oracle-authorize a deploy |
| `getDeploymentRules()` | profile + price table + supply |
| `getMintRules()` | current stage/remaining/minimum |
| `requestMintAuthorization()` | Oracle-authorize a mint + requiredPayment |
| `submitSignedOperation()` | submit signed tx to canonical settlement |
| `getOperationStatus()` | canonical accept/reject/finalized |
| `getCanonicalState()` | canonical token state |
| `getCanonicalActivity()` | canonical activity (paginated) |

Implementations: `MockCanonicalCRCProvider` (demo),
`UnavailableCanonicalCRCProvider` (read-only mainnet), and the future
`GardenCanonicalCRCProvider`. The UI never contains CRC-Garden-specific API
assumptions.

## Product modes

```text
DEMO                 → MockCanonicalCRCProvider     (simulated, labeled "Demo Network")
READ_ONLY_MAINNET    → UnavailableCanonicalCRCProvider (reads only, writes disabled)
CANONICAL_CRC        → GardenCanonicalCRCProvider   (future; all gates must pass)
```

## Canonical mint validation (proposed crc-launch-v1)

A mint is canonical iff (see `docs/CRC_LAUNCH_V1_PROPOSAL.md`):

```text
payment >= requiredPayment(currentSupply, requestedAmount)   (integer curve)
AND requestedAmount <= remainingPublicSupply
AND ticker exists
AND profile == crc-launch-v1
AND authorized by Oracle (if required)
AND not replayed
```

`requiredPayment` is computed from the fixed 20-stage integer price table with
ceiling division per stage chunk. Test vectors: `docs/CRC_LAUNCH_V1_TEST_VECTORS.json`
(run by `packages/curve/test/mint-validation.test.ts`).
