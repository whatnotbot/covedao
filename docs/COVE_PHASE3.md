# Cove Phase 3 — Real Simplicity + Curve Freeze + Lifecycle Spec

## 1. Real Simplicity pre-execution (`packages/cove-simplicity`)

**Verified working.** The Cove MINT policy is a **real Simplicity program**:

- **Simfony source** (`rust/src/mint.simf`): the MINT predicate checks supply
  conservation, no-overmint (≤ 840,000,000 tokens), positive amount, and reserve
  movement — using core jets (`add_64`, `eq_64`, `le_64`, `lt_64`) + `assert!`.
- **Compiled** by the `simfony` crate (v0.1.0) → Simplicity; **CMR computed** by
  rust-simplicity (`simplicity-lang`).
- **Executed** on the Simplicity Bit Machine against witness data.
- **CMR (frozen):** `118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2`.
- **Compiled program (base64, deterministic):**
  `5iHQKHQKHQKHQKHQKHQKEkIMOOOONkcccccLMLc0uRzOKohIroTMAEVcLBi8KWE9gYVC6wl+uKkZCyw4BW3fgCGAYkChJB+DmG4SccccLILSzbkcwLvfahR91ofRxdIEhoraXiTCljMruIwlAG9G26fy7ABhgGIW9g5rruXg9CdT0ZA4zl/jbkryjKfPZUy2qtPZa7RiiPFRiHDAMVmAAAAAGQixAAODhcAC4Q04Bkcz8FVrNkEyx2Bj+VLRZhxh+w1ElWaG0dCZ/89Ws0Q57jBgGIXDjBEX+oDjSJpgMLm9+S+nolYSNH9l/IQDbQwBMtOrd78UHeBVmAAAAAAAAAAAOJB+LxQLiZpwHI5u8lZwLSPPkvMpefT82f85Cc97MlOKr7Djoj7EAHmx0TDAMQuLDeJ0MJHAM98RvFz0eCrDowUWd8HlIb3z/dfqm1KEko5YHhoFG5DHHHG5FHCoXG5tBDoLFPVXJUIItlR+smGqGn+ps2Sl7ABMeUuBMPAFkmDyAApAoSQbj43JY444WIWZtpVnanSODCL5dAHG0YZYXL7/GhLKIDD2ZYRxW4obTlfDx4BQtZvoQT9zeJ/JSg1zVnOQ+dSDqBncb+M9zPuT55FUoWyEHDx0BQnAD8twQDggXEQDAXGQDIXIEBoByZA5YgctQOXIHL0DmBA5hQA=`.

### Honest limitation (documented)
The `simfony` toolchain targets the **Elements/Liquid** jet set; the **Bitcoin
transaction-introspection environment is a stub** upstream. The MINT predicate
therefore receives the transaction state as **witness values**. The full
bonding-curve cost remains in the TypeScript reference `validateMintTx`, which is
the **differential oracle**. This is **not** a Rust `if` statement — it is a real
Simplicity program with a real CMR executed on the real Bit Machine.

### Differential test (TS == Simplicity)
`differential.test.ts` asserts the TypeScript `validateMint` result equals the
Simplicity Bit Machine result over valid (stage sweep) and adversarial (zero,
overmint, supply-conservation mutation, reserve mutation) vectors. **7 tests pass.**
CI: `.github/workflows/cove-simplicity.yml`.

## 2. Curve freeze (`packages/cove-economics`)

Four integer-only curves were compared (`pnpm --filter @crclaunch/cove-economics report`):

| Curve | final reserve | final price | verdict |
| --- | --- | --- | --- |
| **geometric20 (existing)** | **0.24196788 BTC** | 149,731 sats/M | **FROZEN** (matches ~0.24 BTC benchmark) |
| linear ramp | 0.63210000 BTC | 150,000 | rejected (2.6× reserve) |
| quadratic | 0.42280000 BTC | 150,000 | rejected (1.75× reserve) |
| two-segment linear | 0.40005000 BTC | 150,000 | rejected (1.65× reserve) |

The existing 20-stage geometric curve is **frozen** (`id: "geometric20"`): it is
the only candidate that hits the ~0.24 BTC reserve benchmark, and its step
structure is already golden-vectored (24,196,788 sats total raise). Simplicity
complexity = 20-entry lookup + per-chunk `ceilDiv` (documented tradeoff: a linear
ramp would be simpler in Simplicity but raises 2.6× more BTC).

## 3. CMR-bound execution vault (Part B)

The Phase 2 execution leaf now commits the **policy identity** instead of a bare
string:

```
policyIdentityHash = H_CovePolicy(version(1) || op(MINT=0x03) || tokenId || successorStateHash || CMR)
execution leaf      = <policyIdentityHash> OP_EQUALVERIFY <guardian> OP_CHECKSIG
```

Golden policy identity hash: `8728b0c360dbcb66f5df315c1f859fc5c5d4e9b28a42738fb8c775ecf104dbc1`.
Updated vault goldens: output key `e59c39d81fc2469c2bff2d969f0ad8f7affeca20c84bdbb4a9f66632a0dc3f78`,
address `bcrt1pukwrnkqlcfrfc2ll9ktf7zkc77hlaj3qep9ahd9f7enr9gxu8auq2ls5d4`.

**Bitcoin-enforced** (NUMS/no key-path, MAST commitment, tapscript, 144-CSV
recovery, CHECKSIG, UTXO/value conservation) is cleanly separated from
**pre-executed** (Cove economic/state policy, Simplicity predicate).

## 4. DEPLOY envelope (Part D)

Wire namespace is **collision-safe**: `"p":"cove-20"` (NOT `crc-20`/`brc-20`, so
existing CRC/BRC-20 indexers will not misclassify Cove transactions). Public
branding remains "Cove CRC".

```
{"p":"cove-20","op":"deploy","tick":"FROG","type":"bonding",
 "max":"1000000000","public":"840000000","reserve":"160000000",
 "curve":"geometric20","state":"<S0 commitment>","policy":"118425967f…"}
```

The DEPLOY transaction creates the initial NUMS/MAST Cove vault (output 1, per
Command-First topology: OP_RETURN at output 0).

## 5. Lifecycle + adversarial attribution (Part E/F — spec)

MINT signing flow: proposed PSBT → canonical `cove-20` envelope validation →
**real Simplicity execution** → reference-policy differential check → **verify CMR
matches the committed vault policy** → Guardian authorization → **execution
script-path spend** → successor NUMS/MAST vault. The old key-path Guardian signer
is not used.

Adversarial failures are attributed to a layer:

| Mutation | Layer that fails |
| --- | --- |
| wrong OP_RETURN protocol / op / ticker / curve id / policy CMR | envelope parser |
| wrong previous/successor state, overmint, wrong curve payment, underfunded reserve, wrong recipient, wrong fee, extra output, reordered outputs | Simplicity pre-execution + Guardian policy |
| wrong control block / execution leaf, recovery before CSV maturity | Bitcoin Script/Core |

(Attribution verified at the unit level: envelope invariants in the policy
engine, state invariants in both TS + Simplicity, CSV in the Phase 2 real proof.)

## 6. Universal graduation (Part G)

See `docs/COVE_UNIVERSAL_GRADUATION.md` (subagent-delivered). Summary: Universal
uses `"p":"brc-20"`; evidence supports **pre-deployed Universal supply**
(deploy FROG with m=1,000,000,000 → single full-supply mint → transfer-on-claim
distribution). Cross-ledger CRC→Universal atomic retirement is **not publicly
verifiable** (OPI-0 burn-to-mint is Draft/unimplemented).

## 7. Remaining blockers (honest)

- **Full real-Core DEPLOY→MINT lifecycle with script-path execution** is specified
  but not yet wired end-to-end; its components are each verified (Phase 1.5 real
  MINT tx, Phase 2 script-path CSV spend, this phase's real Simplicity + CMR-bound
  vault). This is the next milestone.
- The full bonding-curve cost is not yet compiled into the Simplicity predicate
  (witness-committed today); the geometric20 curve is TS-only until ported.
