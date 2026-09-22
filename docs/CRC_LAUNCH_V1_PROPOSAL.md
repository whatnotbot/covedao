# CRC Launch V1 — Deterministic Progressive Issuance Profile for CRC-20

> **Status: PROPOSED.** This document describes an issuance profile we would like
> the CRC maintainers to consider adopting as a standardized, canonical profile
> named `crc-launch-v1`. **It does not currently exist in CRC.** All encodings
> below are illustrative and must be agreed with CRC maintainers before use.

## 1. Purpose

Give CRC-20 deployments a deterministic, verifiable progressive-issuance curve
so that (a) the required payment for any mint is computable from canonical state
alone, and (b) the canonical validator can independently reject underpayment,
over-mint, and replay — without trusting the launching application.

## 2. Profile identifier

```text
crc-launch-v1
```

## 3. Proposed deployment payload (ILLUSTRATIVE — PROPOSED)

```json
{
  "p": "crc-20",
  "op": "deploy",
  "tick": "FROG",
  "profile": "crc-launch-v1",
  "max": "100000000000000000",
  "dec": "8"
}
```

- `max` = 1,000,000,000 tokens × 10^8 = `100000000000000000` (8-decimal atoms).
- The actual field names/types must be finalized with CRC maintainers.

## 4. Standardized tokenomics

| Parameter | Value |
|---|---|
| Total supply | 1,000,000,000 tokens |
| Decimals | 8 |
| Progressive public issuance | 840,000,000 (84%) |
| Graduation allocation | 160,000,000 (16%) |
| Creator premine | 0 |
| Team allocation | 0 |
| Stages | 20 |
| Tokens per stage | 42,000,000 |
| Price unit | satoshis per 1,000,000 tokens |

The creator mints under exactly the same curve as everyone else.

## 5. Canonical price table (fixed, integer)

| Stage | Public mint progress | Price / 1M tokens (sats) |
|---|---:|---:|
| 1 | 0–5% | 500 |
| 2 | 5–10% | 675 |
| 3 | 10–15% | 912 |
| 4 | 15–20% | 1,231 |
| 5 | 20–25% | 1,661 |
| 6 | 25–30% | 2,243 |
| 7 | 30–35% | 3,027 |
| 8 | 35–40% | 4,087 |
| 9 | 40–45% | 5,517 |
| 10 | 45–50% | 7,447 |
| 11 | 50–55% | 10,054 |
| 12 | 55–60% | 13,572 |
| 13 | 60–65% | 18,323 |
| 14 | 65–70% | 24,735 |
| 15 | 70–75% | 33,393 |
| 16 | 75–80% | 45,080 |
| 17 | 80–85% | 60,857 |
| 18 | 85–90% | 82,157 |
| 19 | 90–95% | 110,912 |
| 20 | 95–100% | 149,731 |

This table is canonical. It must be stored verbatim — never recomputed from a
floating-point formula.

## 6. Canonical mint validation rule

Given:

- `S` = confirmed canonical public supply (in token units, integer)
- `A` = requested mint amount (in token units, integer > 0)
- `P[stage]` = the canonical price table above

The canonical validator walks stages from `S`:

```text
remaining = A
supply = S
payment = 0
stage = stageFor(supply)          // floor(supply / 42,000,000) + 1, clamped to 1..20
while remaining > 0:
    stageEnd      = stage * 42,000,000
    inStage       = stageEnd - supply
    chunk         = min(remaining, inStage)
    price         = P[stage]
    chunkCost     = ceil(chunk * price / 1,000,000)      // integer ceil
    payment      += chunkCost
    supply       += chunk
    remaining    -= chunk
    stage         = stageFor(supply)
```

A mint is **accepted** only if ALL of:

1. `payment >= requiredPayment` (computed above; overpayment is acceptable)
2. `S + A <= 840,000,000` (requested amount does not exceed remaining public supply)
3. the ticker exists in canonical state
4. the deployment's profile is exactly `crc-launch-v1`
5. the operation is authorized by the canonical Oracle (if Oracle auth is required)
6. the operation is not a replay of a previously accepted operation

### Rounding rules (normative)

- Every stage chunk cost uses **integer ceiling division**: `ceil(chunk × price / 1_000_000)`.
- No floating point anywhere.
- The full public issuance (840,000,000 tokens) must total exactly **24,196,788 sats**.

## 7. Normative reference

The reference implementation is the tested `@crclaunch/curve` package
(`quoteExactTokens`, `quoteExactSats`, `getStagePrice`, `getStageForSupply`).
Its test vectors (including the full-raise golden value) are reproduced in
`docs/CRC_LAUNCH_V1_TEST_VECTORS.json` and run as automated tests, so the CRC
team can implement the same vectors against their canonical validator and get
identical results.
