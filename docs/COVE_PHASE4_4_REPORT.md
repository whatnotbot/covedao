# Cove Phase 4.4 — Guardian Enforcement / Simplicity Signing Gate — Report

**Status: COMPLETE on regtest. Mainnet: NOT READY.**

Phase 4.4 replaced the harness-inline Guardian signing from Phase 4.3 with a
production Guardian pipeline that cannot sign a backing-state transition
without passing the entire chain:

```
independent tx parse → canonical Cove reconstruction → real Simplicity execution
→ independent TS/reference validation → CMR verification → full tx validation
→ script-path signing → finalized-tx revalidation → Bitcoin Core
```

---

## Git

- starting SHA: `a2c6e0ac9fbdd6e47fa3fc12d54d45a4485230e9` (reconciled: `origin/main` was 2 commits behind; pushed a clean fast-forward)
- ending SHA: `070d58c70fddbe15ad1ded335d280188f0943976`
- commits (this phase):
  - `07db08b` lint fix (baseline)
  - `6a060ed` break cove-simplicity → cove-guardian cycle
  - `0fb9da4` strict fail-closed Simplicity executor + canonical witness constructors
  - `c0e1342` production V3 Guardian module
  - `070d58c` fee-dust settlement, hardened broadcast, mutation + architecture tests
- branch: `main`
- push status: **NOT pushed** (local `main`; see "do next")
- working tree: clean except untracked `fr.html` (left untouched)

---

## Dependency graph

**Before** (wrong direction, latent cycle):

```
cove-simplicity ──depends-on──▶ cove-guardian   (differential test imported validateMint)
```

**After**:

```
cove-economics ──▶ curve
cove-covenant  ──▶ cove-economics, cove-wire, curve
cove-simplicity ─▶ cove-covenant, cove-economics, curve
cove-guardian  ──▶ cove-simplicity, cove-covenant, cove-economics, cove-vault, cove-wire, curve
```

- `@crclaunch/cove-simplicity` **does not** depend on `@crclaunch/cove-guardian`
  (enforced by `scripts/check-dependency-graph.mjs`, wired into CI).
- `@crclaunch/cove-guardian` **does** depend on `@crclaunch/cove-simplicity`.
- No workspace cycle.

---

## Simplicity

- MINT source: `packages/cove-simplicity/rust/src/mint.simf` (embedded in `main.rs`)
- MINT expected CMR: `0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377`
- MINT actual compiled CMR: `0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377` (MATCH)
- REDEEM source: `packages/cove-simplicity/rust/src/redeem.simf`
- REDEEM expected CMR: `37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56`
- REDEEM actual compiled CMR: `37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56` (MATCH)
- Execution mechanism: real `simfony` + rust-simplicity Bit Machine via the
  compiled `cove-simplicity` binary (`exec mint|redeem '<mod witness …>'`).
- timeout: `SIMPLICITY_TIMEOUT_MS = 10_000` (executor `timeout` option).
- failure behavior: typed, fail-closed — `SIMPLICITY_BINARY_MISSING`,
  `SIMPLICITY_EXECUTION_ERROR`, `SIMPLICITY_TIMEOUT`, `SIMPLICITY_MALFORMED_RESULT`,
  `CMR_MISMATCH`, `SIMPLICITY_REJECTED`. PASS only on exact frozen CMR + successful
  Bit Machine run. No TS-only fallback, no skip.

---

## Guardian

- production signer paths: `packages/cove-guardian/src/v3/` (`types.ts`,
  `resolve.ts`, `analyze.ts`, `validate.ts`, `witness.ts`, `signer.ts`,
  `finalize.ts`, `audit.ts`, `guardian.ts`, `broadcast.ts`).
- public signing APIs: **only** `validateAndSignMintTransition` and
  `validateAndSignRedeemTransition`.
- private signing primitive: `GuardianV3Signer.signVaultExecutionLeaf`
  (not exported as a generic signer); it independently re-verifies its own
  BIP341 Schnorr signature before returning.
- canonical-view interface: `CoveCanonicalView` (`getBackingStateByOutpoint`,
  `getCurrentBackingState`, `getBackingOutpoint`, `getTokenUtxo`); `CoveChainView`
  implements it; a future indexer adapter will implement another.
- NO public `signHash` / `signAnything` / `signPsbtUnchecked` / `exportPrivateKey` /
  `getGuardianWif`.

---

## MINT signing trace

- backing outpoint: `12305edde8eb550f891465106e042563bda0e110758447578d71665ef5a354ce:1`
- prev state: S0 (supply 0, backing 0)
- wire: v2 MINT, 84M tokens (84,000,000,000,000 atoms), recipientVout 2
- next state: supply 84M, backing 49,350 = R(84M)
- R(old)=0, R(new)=49,350, gross=49,350, fee=494 (1%)
- CMR: `0b594eb3…` (expected == actual)
- Simplicity: PASS
- reference: PASS
- signature: script-path MINT leaf, independently Schnorr-verified
- final validation: `validateFinalizedMintTransaction` PASS
- testmempoolaccept: allowed=true
- txid: `005e1ba5de13937682563b0fff5046b69ecd193a76be94da26864e130187de4b`

## REDEEM signing trace

- backing outpoint: `005e1ba5…:1`
- prev state: supply 84M, backing 49,350
- wire: v2 REDEEM, 84M tokens, zero change allocations
- next state: supply 0, backing 0
- gross=49,350, fee=494, net payout=48,856
- CMR: `37e681b3…` (expected == actual)
- Simplicity: PASS
- reference: PASS
- signature: script-path REDEEM leaf, independently Schnorr-verified
- final validation: `validateFinalizedRedeemTransaction` PASS
- testmempoolaccept: allowed=true
- txid: `3b1fe487de2fc24fc59fee067c1cd5d7b40e85f914ce3ab5b65b3c1bcc0fd92d`

## RE-BUY

- Invoked `validateAndSignMintTransition` again (S0 → 84M) — MINT Simplicity PASS,
  reference PASS, CMR match, Guardian signed. txid `3dccfdbc…`.

## P2P

- Ordinary holder + buyer signatures; **no Guardian**; backing and supply
  unchanged (49,350 sats, 84M). One atomic tx (token input + BTC payment →
  buyer carrier + seller BTC + 50 bps fee). txid `895647be…`.

---

## Adversarial tests

Exact mutations (each asserted `ok:false` **and** input 0 has NO signature):

MINT (11): wrong backing outpoint, wrong backing value, mutated wire amount,
successor backing +1, protocol fee +1, fee destination mutated, carrier +1,
wrong tap leaf (REDEEM leaf), excessive miner fee, extra output, mainnet.

REDEEM (2): seller payout +1 sat, forged token input (non-canonical outpoint).

Simplicity executor failure injection (9): missing binary, malformed JSON,
missing result field, mutated CMR, substituted V1 CMR, Bit-Machine FAIL,
timeout, nonzero exit, nonexistent binary path.

Witness-constructor rejection (4): non-canonical successor state, wrong gross,
sub-token amount, negative/sub-token unit conversion.

**Resulting Guardian signatures: 0** (all refused before signing).

---

## Fee dust

- mechanism: `checkFeeSettlement(nominalFee, feeScript, feeBps)` in
  `cove-economics` → `{isStandard, dustThresholdSats, minimumGrossForStandardFeeOutput}`.
- example sub-dust nominal fee: 210 sats (1% of a 21,000-sat gross) to P2WPKH
  (dust 294) → `isStandard:false` → Guardian returns `PROTOCOL_FEE_DUST`.
- minimum executable gross for configured P2WPKH fee output @ 100 bps: **29,301 sats**.
- mainnet fee policy status: **UNFROZEN**. Available future choices documented
  (different fee schedule, explicit minimum order, fee-accumulator architecture,
  or another reviewed mechanism) — no new mainnet economics chosen autonomously.

---

## Real Core lifecycle (Bitcoin Core 28.1 regtest)

| step | txid | height | testmempoolaccept |
|------|------|--------|-------------------|
| DEPLOY | `12305edde8eb550f891465106e042563bda0e110758447578d71665ef5a354ce` | 1 | allowed=true |
| MINT | `005e1ba5de13937682563b0fff5046b69ecd193a76be94da26864e130187de4b` | 2 | allowed=true |
| TRANSFER | `2b71c09617a7354d032b800630ffc9cab8205f74123615b32c9191cd3ca24130` | 3 | allowed=true |
| REDEEM | `3b1fe487de2fc24fc59fee067c1cd5d7b40e85f914ce3ab5b65b3c1bcc0fd92d` | 4 | allowed=true |
| RE-BUY | `3dccfdbc59d604c01b3a072edb6d3b359d14ea9b3f46e2d8ffc711d3cc0880c9` | 5 | allowed=true |
| P2P | `895647be3495b5bd2d2b41a97ea9d9614225f04b1087504e8a7e8ddc0e2492d8` | 6 | allowed=true |

## Reorg

`invalidateblock 4d39d8dbe564680c…` → re-mined `5ed970743bf1ec39…` (different
tip, same P2P txid). Deterministic replay from raw hex rebuilt identical state
(supply 84,000,000,000,000 atoms, backing 49,350, balance 84,000,000,000,000).

---

## Tests

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 errors/warnings
- `pnpm test` — **608 tests passed** (bitcoin 50, config 20, cove-covenant 59,
  cove-economics 47, cove-guardian 51, cove-indexer 41, cove-simplicity 38,
  cove-vault 23, cove-wire 45, curve 98, db 4, protocol 113, web 19)
- `pnpm build` — 0 errors
- `node scripts/check-dependency-graph.mjs` — OK (no cycles)

## CI

- `.github/workflows/ci.yml` — typecheck+lint+test+build + dependency-graph check
- `.github/workflows/cove-v3-lifecycle.yml` — installs Rust, builds the
  cove-simplicity release binary, verifies the frozen V3 CMRs, then runs the
  production lifecycle (fails, never skips, if Simplicity/Core is absent).

---

## Trust model (exact)

**BITCOIN ENFORCES:** canonical Bitcoin UTXO spending, holder signatures,
Taproot script-path commitment, revealed tapleaf/control-block validity,
Guardian CHECKSIG, CSV recovery, Bitcoin value conservation, double-spend
prevention.

**SIMPLICITY PRE-EXECUTION VALIDATES:** the invariants actually encoded in the V3
program (positive amount, supply conservation, no over/underflow, reserve/backing
movement). It does **not** implement the full geometric20 curve.

**REFERENCE COVE POLICY VALIDATES:** complete CoveStateV2 transition, geometric20
exact R-delta, token-UTXO semantics, output/payment/fee semantics.

**GUARDIAN:** executes both required policy layers and signs only after acceptance.

Bitcoin itself still does **not** execute Simplicity. CMR commitment does **not**
make Bitcoin independently validate Simplicity semantics. **Guardian compromise
remains a trust assumption.**

---

## Remaining mainnet blockers

- production indexer persistence/reorg
- production marketplace/order service
- product UI/API
- recovery quorum (current 144-block single-key CSV is dev-only)
- real operational key custody
- mainnet Guardian deployment
- fee schedule decision (mainnet fee policy is UNFROZEN)
- rate limits / value caps / monitoring
- mainnet canary process
- durable-before-sign audit semantics (currently best-effort console logging)

**Mainnet: NOT READY.**
