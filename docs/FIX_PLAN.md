# FIX PLAN — audit remediation

**Generated:** 2026-09-23
**Source:** three independent audits of the working tree at commit `64a1f1a` + uncommitted changes.
**Audience:** the coding agent working this repository.

---

## How to use this document

Work **strictly in order**. P0 first, top to bottom. Do not skip ahead.

After **every** numbered item:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must be green before you start the next item. If an item cannot be completed, **stop and report** — do not work around it, and do not delete a test to make a suite pass.

### Rules for this work

1. **Never delete or weaken a test to make a suite green.** If a test fails, either the code is wrong or the test is wrong. Say which, and fix that.
2. **Never use `--passWithNoTests` to hide a missing suite.** Write the suite.
3. **Never commit a zero-byte or empty test file.** If you are mid-refactor, finish the refactor before running the suite.
4. If a fix reveals a second defect, **write it down at the bottom of this file under "Discovered during remediation"** and carry on. Do not silently expand scope.
5. Every change to a consensus-relevant file (`packages/protocol/src/cove/**`, `packages/bitcoin/**`, `packages/curve/**`) needs a test that fails before your change and passes after.

### Verification status legend

- `VERIFIED` — the auditor reproduced this by executing code.
- `READ` — confirmed by reading the source at the cited line.

---

# P0 — MONEY LOSS AND SECURITY

These can lose funds or let a stranger destroy data. Nothing else matters until these are done.

---

## P0-1 — `buildUnsignedPsbt` silently sends funds to the miner

**File:** `packages/bitcoin/src/psbt.ts:78-83`
**Status:** VERIFIED — a 50,000 sat output was dropped and the value went to fees.

An output with neither `address` nor `script` is skipped by the `if / else if` (no `else`), but its `value` is still added to `totalProtocolOut` at line 78. The transaction is returned successfully. The money goes to the miner.

**Do this:**

1. Make the missing-field case impossible to compile. Change the output type in `BuildTxParams` (`psbt.ts:29`) from a shape with two optional fields to a discriminated union:

```ts
type TxOutput =
  | { readonly script: Uint8Array; readonly valueSats: bigint; readonly address?: never }
  | { readonly address: string;    readonly valueSats: bigint; readonly script?:  never };
```

2. Add a runtime guard anyway (the union can be defeated by a cast). In the output loop, add a final `else` that throws:

```ts
} else {
  throw new Error(`Output ${i} has neither address nor script`);
}
```

3. Fix every caller the type change breaks. Known callers: `packages/protocol/src/cove/build.ts:58-61, 93-97, 113-117`.

**Test (new file `packages/bitcoin/src/psbt.test.ts`):** assert that an output object with neither field throws, and that the thrown message names the output index.

**Acceptance:** it is not possible to build a PSBT whose declared output total exceeds the sum of its actual outputs.

---

## P0-2 — the reported fee is not the real fee

**File:** `packages/bitcoin/src/psbt.ts:88-102`
**Status:** VERIFIED — reported `feeSats: 142n`, actual on-chain fee `542n`.

When change falls below the dust floor it is folded into the fee, but `feeSats` and `changeSats` are never recomputed. The returned object lies. Separately, `changeSats` is reported as non-zero (`500n`) on transactions that have no change output at all.

This is worse than an overpay: **any downstream guard that reads `CovePsbt.feeSats` is bypassed.** That includes the max-fee guard you are about to add in P0-3.

**Do this:**

1. After the final output set is assembled and before returning, recompute from the actual PSBT:

```ts
const actualOutTotal = /* sum of every value actually added to the psbt */;
const actualFee = totalIn - actualOutTotal;
const actualChange = /* the change output's value, or 0n if none was added */;
```

2. Return `actualFee` and `actualChange`, not the pre-computed estimates.

3. Add an assertion before returning, so this can never silently regress:

```ts
if (actualFee !== totalIn - actualOutTotal) {
  throw new Error("fee accounting mismatch");
}
if (actualFee < 0n) {
  throw new Error("negative fee");
}
```

**Test:** build a transaction whose change lands below the dust floor. Assert `result.feeSats` equals `totalIn` minus the sum of the real outputs, and that `result.changeSats` is `0n`.

**Acceptance:** `feeSats === totalIn - Σ(actual outputs)` holds for every build path, including the dust-fold path and the no-change path.

---

## P0-3 — there is no maximum fee guard anywhere in the system

**Files:** `packages/config/src/load.ts:102-104`, `packages/bitcoin/src/psbt.ts:93`, `packages/bitcoin/src/provider.ts:165-178`
**Status:** VERIFIED — a fee rate of 500,000 sat/vB produced a **0.71 BTC** fee and was accepted.

`MAX_MINER_FEE_SATS` and `MAX_FEE_RATE_SAT_VB` are parsed into config, typed, documented in `.env.example:43-44`, and claimed as a mitigation in `docs/THREAT_MODEL.md:24`. A repo-wide grep for `maxMinerFeeSats|maxFeeRateSatVb` finds **only the declaration and the loader**. Nothing reads them.

`CoreRpcProvider.estimateFeeRate()` applies no upper bound either — a node returning `0.01 BTC/kvB` yields 1000 sat/vB and it is accepted. `broadcastTransaction` passes no `maxfeerate` to `sendrawtransaction`, so Bitcoin Core's own default is the only backstop, and that is the node's protection, not yours.

**Do this — all four parts:**

1. Add `maxFeeRateSatVb` and `maxMinerFeeSats` to `BuildTxParams`. Make them **required**, not optional, so no caller can forget.

2. In `buildUnsignedPsbt`, before returning, enforce both against the **recomputed** fee from P0-2:

```ts
if (params.feeRateSatVb > params.maxFeeRateSatVb) {
  throw new Error(`fee rate ${params.feeRateSatVb} exceeds max ${params.maxFeeRateSatVb}`);
}
if (actualFee > params.maxMinerFeeSats) {
  throw new Error(`fee ${actualFee} exceeds max ${params.maxMinerFeeSats}`);
}
```

3. Clamp `CoreRpcProvider.estimateFeeRate()` (`provider.ts:169-178`) to a caller-supplied ceiling. Do not trust the node.

4. Pass an explicit `maxfeerate` to `sendrawtransaction` in `broadcastTransaction` (`provider.ts:165-167`).

5. Reject a zero or negative fee rate. `feeRateSatVb: 0n` is currently accepted and produces a `fee = 0` transaction that can never relay.

**Test:** assert that exceeding each cap throws, that the boundary value (exactly at the cap) is accepted, and that `feeRateSatVb: 0n` throws.

**Acceptance:** `docs/THREAT_MODEL.md:24` becomes a true statement. If you choose **not** to implement these, delete both vars from `packages/config/src/load.ts`, `types.ts`, `.env.example` and `THREAT_MODEL.md` in the same change. Do not leave documented controls that do not exist.

---

## P0-4 — a stranger on the internet can wipe the database

**File:** `apps/web/src/app/api/demo/reset/route.ts:10`
**Status:** READ.

An unauthenticated public `POST`. It is network-guarded (403 unless `network === "mock"`, lines 13-15) but has **no authentication of any kind**. It wipes Redis chain state (line 16) and calls `resetAllTables(db)` (line 32).

`resetAllTables` (`packages/db/src/repo.ts:556-560`) truncates the **preserved** tables too — `reports`, `terms_acceptances`, `admin_audit_logs`, `media` — not just the rebuildable projections.

There is zero rate limiting anywhere in the repository (see P1-9), so this is trivially repeatable.

**Do this:**

1. Require the admin bearer token on this route. Reuse the check from `apps/web/src/app/api/admin/status/route.ts`, but **without** the dev bypass — see P0-5.
2. Additionally require `NODE_ENV !== "production"`.
3. Return 404, not 403, when the route is unavailable. Do not advertise its existence.

**Test:** assert 404 without a token, 404 in production, 200 with a valid token in mock + non-production.

---

## P0-5 — every safety gate is inert in the web app

**File:** `apps/web/src/lib/env.ts:8`
**Status:** READ. Confirmed: the only caller of `validateConfig` is `apps/worker/src/index.ts:17`.

`packages/config/src/load.ts` has a `validateConfig` function containing every fail-closed startup check:

- required `ADMIN_AUTH_SECRET` in production (`load.ts:132-136`)
- refuse to boot when a mainnet write flag is on but `CRC_PROTOCOL_VERIFIED` is false (`load.ts:139-146`)
- required treasury address (`load.ts:147-151`)
- mainnet-vs-testnet treasury address check (`load.ts:154-174`)

**`apps/web` never calls it.** It calls `loadConfig` alone. The web app is the one serving the money endpoints.

**Do this:**

1. Call `validateConfig(config)` in `apps/web/src/lib/env.ts` immediately after `loadConfig`, and let it throw at module load.
2. Confirm the failure is loud — the app must refuse to start, not log and continue.

**Test:** assert the web config module throws when a mainnet write flag is set with `CRC_PROTOCOL_VERIFIED=false`.

**Note:** this is the item that invalidates the earlier claim "it is not possible to accidentally touch mainnet." Until it is fixed, that claim is false for the web app.

---

## P0-6 — fees are sent to an empty address

**File:** `apps/web/src/lib/treasury.ts:6`
**Status:** READ. Consumed unvalidated at `mint/build/route.ts:87`, `launch/build/route.ts:49`, `market/buy/build/route.ts:29`.

Returns `""` for any non-mock network when `PLATFORM_TREASURY_ADDRESS` is unset.

**Do this:** throw instead of returning `""`. The error must name the missing environment variable.

**Related:** `packages/config/src/load.ts:158` only runs the address sanity check when the network is mainnet. On `test`, an arbitrary garbage string passes. Extend the check to every non-mock network.

---

## P0-7 — Taproot and legacy inputs cannot be signed

**File:** `packages/bitcoin/src/psbt.ts:69-73`
**Status:** VERIFIED — P2PKH and P2TR inputs both throw at `signInput` time.

`witnessUtxo` is set unconditionally for every input. `nonWitnessUtxo` is never set. There is no branch on script type.

- **P2PKH input** → `signInput` throws `Input #0 has witnessUtxo but non-segwit script`. The builder returns this PSBT successfully; it is discovered to be unsignable only in the user's wallet.
- **P2TR input** → `tapInternalKey` is never set, and because `initEccLib()` is never called, bitcoinjs cannot even classify the script as Taproot. It falls into the legacy path and throws the same misleading error.
- **P2TR output given as `address`** → hard crash: `No ECC Library provided. You must call initEccLib()`.
- **P2SH-P2WPKH / P2WSH** → no `redeemScript` / `witnessScript` is ever set. Unsupported.

`tiny-secp256k1` and `ecpair` are declared in `packages/bitcoin/package.json:23,25` and **never imported anywhere in the repository**. They are installed and dead.

**Do this:**

1. At module load in `packages/bitcoin/src/psbt.ts`:

```ts
import * as ecc from "tiny-secp256k1";
bitcoin.initEccLib(ecc);
```

2. Branch on the input's script type in `addInput`:
   - **P2WPKH / P2WSH** — `witnessUtxo` (current behaviour, correct)
   - **P2TR** — `witnessUtxo` **plus** `tapInternalKey`
   - **P2PKH and any non-segwit** — `nonWitnessUtxo` with the full previous raw transaction. This requires fetching it; extend `ChainUtxo` to carry the raw parent transaction hex, or fetch it via the provider.
   - **P2SH-P2WPKH** — `witnessUtxo` + `redeemScript`
   - **Anything unrecognised** — throw. Do not guess.

3. Set `sighashType: bitcoin.Transaction.SIGHASH_ALL` explicitly on every input. It is currently `undefined`, which leaves a signer free to use `SIGHASH_NONE` or `SIGHASH_SINGLE`. Output ordering is load-bearing in Cove (`build.ts:58-61, 93-97, 113-117`), so this matters.

**Test:** for each supported input type, build and then **actually sign** with a test key, and assert the signed transaction verifies. Use regtest or fixed test vectors. If an input type is deliberately unsupported, assert the build throws a clear error rather than producing an unsignable PSBT.

---

## P0-8 — transactions cannot be fee-bumped

**File:** `packages/bitcoin/src/psbt.ts:69-73`
**Status:** VERIFIED — `sequence = 0xffffffff`, RBF-signalling `false`.

`sequence` is never set, so it defaults to final. Combined with the fee under-estimate in P0-9, a stuck transaction is unrecoverable except by CPFP.

**Do this:** set `sequence: 0xfffffffd` on every input.

**Test:** assert every input in a built PSBT signals RBF.

---

## P0-9 — the fee estimate is wrong for address outputs, and it is a regression

**File:** `packages/bitcoin/src/psbt.ts:50-52, 90`
**Status:** VERIFIED — claimed 2,400 sats at 20 sat/vB; true signed vsize gives 2,820. Effective rate 17.02 vs 20 requested.

```ts
export function estimateOutputVsize(script: Uint8Array) { return 8 + 1 + script.length; }
...
vsize += estimateOutputVsize(o.script ?? Buffer.alloc(0));
```

For an `{address: ...}` output, `o.script` is `undefined`, so it measures an empty buffer: **9 vbytes** instead of 31 (P2WPKH), 34 (P2PKH) or 43 (P2TR).

The previous code used a flat 31 vB per output. For address outputs the new code is **worse**. It only fails to bite today because `cove/build.ts` passes raw scripts everywhere — one caller switching to `{address}` silently under-pays.

**Do this:** resolve the address to a script with `bitcoin.address.toOutputScript(addr, network)` **before** measuring, then measure the real script.

**Also:** `vsize += 31` for change (line 91) assumes P2WPKH. Measure the actual change script — a P2TR change address is 43 vB.

**The input estimates are correct** (P2WPKH 68, P2TR 58, P2PKH 148 — all verified against real weight math). Leave them alone.

**Test:** for each output type, assert the estimate is within 1 vbyte of the true signed vsize.

---

## P0-10 — change uses a hardcoded dust floor

**File:** `packages/bitcoin/src/psbt.ts:95`
**Status:** READ.

Hardcodes `546n`. `packages/bitcoin/src/dust.ts` is already imported into this very file (line 4) for `isP2TR`/`isP2WPKH`, and then not used for the dust decision. The correct P2WPKH threshold is **294**, not 546.

**Do this:** call `dustThreshold(changeScript)`.

---

## P0-11 — one malformed transaction permanently halts the indexer

**Files:** `packages/bitcoin/src/decoder.ts:115-121`, `packages/cove-indexer/src/cli.ts:58-72`
**Status:** VERIFIED — a real transaction carrying scriptPubKey `6a4d` throws `RangeError` and sets `process.exitCode = 1`.

```ts
} else if (len === 0x4d) {
  len = script.readUInt16LE(offset);   // offset=2, no length check
} else if (len === 0x4e) {
  len = script.readUInt32LE(offset);   // offset=2, no length check
}
```

The `0x4c` branch is guarded (line 112). The `0x4d` and `0x4e` branches are not — `readUInt16LE`/`readUInt32LE` throw instead of returning `undefined`. A function documented to return `Uint8Array | undefined` throws `RangeError`.

`decodeRawTransaction` calls this on every output starting with `0x6a`, and `scanRange` has **no per-transaction error handling**. One poisoned output halts indexing at that height permanently — re-running hits the same block again.

A `6a4d`-truncated script is non-standard so it will not relay normally. **But coinbase transactions are exempt from standardness**, and miners routinely put arbitrary `OP_RETURN` data in coinbase outputs. On signet the signet miner can produce one trivially. This is not theoretical.

**Do this:**

1. Bounds-check both branches. Return `undefined` when the buffer is too short, matching the documented return type.
2. Wrap the per-transaction decode at `cli.ts:63` in `try/catch`. Log the txid and skip that transaction. **One bad transaction must never halt a block scan.**
3. Also handle the silently-truncated-push case (`decoder.ts:122`): `script.subarray(offset, offset + len)` is clamped by Buffer rather than validated, so a push declaring 4,294,967,295 bytes returns 4 bytes with no error. Validate that the declared length matches what is available, and return `undefined` if not.

**Note:** `parseCanonicalOpReturn` (`decoder.ts:130-146`) is correct and fully bounds-checked. That is the strict parser used for acceptance. The bug is in the **loose** parser used for candidate detection at `cli.ts:30`. Keep the loose-gate / strict-accept shape — just stop the gate crashing.

**Test:** assert `opReturnPayload` returns `undefined` (does not throw) for `6a4d`, `6a4e01`, `6a4c`, and a push declaring more bytes than exist. Then assert a block containing such a transaction still scans to completion.

---

## P0-12 — the indexer trusts a third-party node without verifying blocks

**Files:** `packages/bitcoin/src/provider.ts:105-115`, `packages/cove-indexer/src/cli.ts:6`
**Status:** READ.

`getBlock` does `bitcoin.Block.fromHex(raw)` and returns the **requested** hash verbatim. `block.getId()` is never compared to the requested hash. The merkle root is never checked against the parsed transaction ids.

The default RPC is a third-party public node (`https://bitcoin-signet-rpc.publicnode.com`), and `requireSignet` trusts that node's self-reported `chain` field.

For an indexer whose entire claim is a deterministic canonical state root, an unverified upstream is the weak link.

**Do this:**

1. In `getBlock`, assert `bitcoin.Block.fromHex(raw).getId() === hash`. Throw on mismatch.
2. Verify the merkle root against the parsed transaction ids.
3. Add `AbortSignal.timeout()` to every RPC call (`provider.ts:70-74` is a bare `fetch` with no timeout — a hung node stalls the indexer forever).
4. Bound the `decodedCache` Map (`provider.ts:61`) — it is currently unbounded and grows forever.

---

## P0-13 — four destructive operations have no guards

**Status:** READ. All four still present.

| File | Problem |
|---|---|
| `apps/worker/src/demo-reset.ts:44` | `resetAllTables(db)` — TRUNCATEs every table including preserved ones. No network guard, no environment guard. |
| `apps/worker/src/index.ts:26` | `seedMockChain(node)` called unconditionally. The mining loop below it **is** gated (line 56); the seed is not. Writes FROG/DOGE/MOON/TREE into any network's database. |
| `apps/worker/src/reindex.ts:20-22` | Builds a `MockChainNode` and syncs it to the database regardless of `config.network`. Reprojects the **mock** chain into production. |
| `apps/worker/src/sync.ts:74` | `resetProjections(db)` TRUNCATEs across **all** networks — no `WHERE network = ...`. Called on every detected reorg. |

**Do this:**

1. `demo-reset.ts` — refuse to run unless `config.network === "mock"` **and** `NODE_ENV !== "production"`. Exit non-zero with a clear message otherwise.
2. `index.ts:26` — wrap in `if (config.network === "mock")`, matching the guard already on line 56.
3. `reindex.ts` — refuse to run for a non-mock network until a real chain source exists.
4. `sync.ts:74` / `packages/db/src/repo.ts:551-553` — scope `resetProjections` to a single network. Add a `network` parameter and a `WHERE network = $1` clause.

**Test:** assert each of the four refuses to act when `CRC_NETWORK` is not `mock`.

---

# P1 — CORRECTNESS AND PROTOCOL SOUNDNESS

---

## P1-1 — the build is red

**Status:** VERIFIED at audit time. Re-verify first — the tree was being actively edited and some of this may already be fixed.

```bash
pnpm typecheck   # was PASS
pnpm build       # was PASS
pnpm lint        # was FAIL
pnpm test        # was FAIL
```

Known causes:

1. `packages/protocol/src/cove/validator.ts:127:66` — `'cfg' is defined but never used`. Lint failure.
2. `packages/cove-indexer` had **zero test files** and no `--passWithNoTests`, which aborted `pnpm test`. A later audit found `indexer.test.ts` restored with 7 passing tests. **Verify which state you are in.**
3. `cove/build.test.ts` and `cove/state-root.test.ts` were at one point present but containing **zero tests**. Later restored to 4 and 3 tests. **Verify.**
4. `cove/validator.test.ts:249` asserted `WRONG_CONTINUATION` and received `valid: true`. Later reported passing. **Verify — and if it is passing because the assertion was changed rather than the code, revert the test and fix the code.**

**Do this:** re-run all four commands. Fix whatever is actually red. Then:

5. **Remove `eslint.ignoreDuringBuilds: true` from `apps/web/next.config.mjs:20`.** This is why the build passes green while lint fails. The build currently gates nothing.

---

## P1-2 — the Cove state root is not fit for purpose

**File:** `packages/protocol/src/cove/state-root.ts:29`
**Status:** READ.

Three independent defects, any one of which makes the root useless as a cross-implementation check.

### (a) It does not commit to the rules it was validated under

The domain string is the hardcoded literal `"cove:1:signet"`. The root does not commit to: network, genesis height, treasury script, settlement script, launch fee, fee bps, or minimum contribution.

Two indexers running **different configs** produce **identical roots** for identical ledgers. A mainnet indexer would silently emit signet-domain roots.

**Do this:** derive the domain from `CoveConfig`. Hash the full config — network, genesis height, both scripts, all fee parameters — into the domain separator.

### (b) The root is history-dependent

`applyCoveOperation` TRANSFER (`validator.ts:210`) does `sender.availableAtoms -= amount` and never deletes the entry. A holder drained to zero leaves `owner:dep:0:0` in the root forever.

Two indexers that reach the same logical state by different paths produce different roots. Any implementation that prunes zero entries — or any checkpoint export and re-import — diverges.

**Do this:** decide the rule, write it into the spec, and implement it. Recommended: **prune entries where both `availableAtoms` and `lockedAtoms` are zero.**

### (c) Serialisation framing is unsafe

Fields are joined by `:`, records by `\n`, sections by `\n---\n`, with no length prefixes and variable-width decimal integers. This is safe only because every current field happens to be constrained hex or `[A-Z0-9]{4}`. It is one type change away from a delimiter-injection collision.

`.sort()` also relies on JS UTF-16 lexicographic ordering. All current inputs are ASCII so JS sort equals byte sort, but the spec never states "byte-lexicographic" — a Rust or Go implementation is free to differ.

**Do this:** length-prefix every field, use fixed-width integers, and specify byte-lexicographic ordering explicitly in the spec document.

**Test — this is the one that matters:** assert **order-independence**. Build the same logical state twice by applying the same balances in two different orders. The roots must be equal. This property is what makes a root canonical, and it is currently untested.

---

## P1-3 — no conservation invariant

**Status:** READ. This is the cheapest high-value fix on the list.

`packages/protocol/src/mock/chain.ts` has `assertProtocolInvariants` (~60 lines) verifying supply-in-range, no negative balances, `locked <= balance`, ticker-index consistency, and critically **Σ(all wallet balances) == confirmedSupply, per token**.

**Cove has nothing equivalent.** No conservation invariant is asserted anywhere, in code or in tests. For a ledger intended to hold value this is the most important single omission found.

**Do this:**

1. Port `assertProtocolInvariants` to operate on `CoveState`.
2. Call it after **every** applied operation in `CoveIndexer.processBlock`.
3. Make a violation a hard throw, not a log line.

**Test:** assert the invariant holds after a long randomised sequence of valid deploy / mint / transfer operations.

---

## P1-4 — TRANSFER replays and double-spends

**File:** `packages/cove-indexer/src/indexer.ts`
**Status:** READ.

`CoveIndexer` has no seen-txid set. Feeding the same block twice is caught for DEPLOY (`TICKER_TAKEN`) and MINT (`STALE_SUPPLY`) **by accident** of unrelated state checks. **TRANSFER replays successfully and double-applies.**

**Do this:** add a `Set<txid>` of applied operations. Reject any txid already applied. Include it in the state root so two indexers cannot disagree about what has been seen.

**Test:** process the same block twice; assert the state root is unchanged and no balance moved.

---

## P1-5 — the indexer has no reorg handling and no persistence

**File:** `packages/cove-indexer/src/indexer.ts`, `packages/cove-indexer/package.json`
**Status:** VERIFIED by running the CLI.

- No block hashes tracked, no parent hashes, no `rollbackTo(height)`, no rewind.
- The existing "reorg" test (`indexer.test.ts:104`) only asserts that rebuilding from different blocks gives a different root. That is replay determinism, not reorg handling.
- Full replay from genesis on **every run**. `scanRange` loops `for (h = from; h <= to; h++)`.
- **No persisted cursor.** No database, no file, no Redis. Zero storage dependencies in `package.json`.
- On restart: starts over from height 323323 with empty state. All state is in-process `Map`s.

`apps/worker/src/sync.ts:35-61` already does real cursor-hash comparison and common-ancestor walk-back for the mock chain. **That machinery was not reused.**

**Do this:**

1. Persist the cursor and per-height block hashes.
2. Implement `rollbackTo(height)`.
3. Port the common-ancestor walk from `apps/worker/src/sync.ts:35-61`.
4. Make sync genuinely incremental from the persisted cursor.

**Test:** apply blocks 1-10, then replace blocks 8-10 with a different branch. Assert the resulting state root equals a clean re-index of the final chain.

---

## P1-6 — `genesisHeight` is decorative

**File:** `packages/protocol/src/cove/config.ts:11`, `packages/cove-indexer/src/indexer.ts:68`
**Status:** VERIFIED — `--from 323320` folded three blocks **below** genesis 323323.

`CoveIndexer.processBlock` accepts any height, never compares to genesis, never requires contiguity or monotonicity.

**Do this:** reject any block below `genesisHeight`. Reject non-contiguous heights. Reject a height at or below the current cursor unless a rollback has been performed.

**Related CLI bug:** `cli.ts:95` sets `canonical = fromFlag === undefined`, so **any** explicit `--from` triggers the warning `"NON-CANONICAL PARTIAL SCAN: --from is above genesis"` — even when `--from` is *below* genesis. The condition never compares to genesis and the message text is wrong. Fix both.

---

## P1-7 — three consensus fields are dead

**Status:** READ.

| Field | Where | Problem |
|---|---|---|
| `lockedAtoms` | `cove/types.ts:51-57`, read at `validator.ts:139`, in the state root | **Never written anywhere.** Always 0. `docs/TRUST_MODEL.md` describes "available = balance − locked" — that describes nothing. |
| `CoveTransaction.txIndex` | plumbed through the mapper into events | Never read by the validator or the state root. |
| `CoveTransaction.continuation` | set by the mapper | **Never read by the validator.** The continuation check (`validator.ts:148-155`) works off `protocolOutputs` only. A test was written asserting otherwise, failed, and was patched — rather than the field being removed. |

Each of these reads as a protection and enforces nothing. That is how a future reader builds on a guarantee that does not exist.

**Do this:** for each — either wire it into validation with a test, or delete it from the type, the state root and the docs. Do not leave them.

---

## P1-8 — six dropped test behaviours must be restored

**Status:** VERIFIED against `git show HEAD:<path>`.

The deleted test files were a mid-refactor transient and have been restored (Cove went 50 → 53 cases). **But six specific behaviours from HEAD were dropped and not replaced:**

1. **`validator.test.ts` — "advances stage after filling stage 1."** Multi-stage curve traversal and `getStageForSupply` advancement is now **completely untested in Cove**. This is the only place the pricing curve crosses a stage boundary (500 → 675 sats per million). **Restore this first.**
2. **`indexer.test.ts` — "records invalid operations without mutating state."** The explicit `reserveSats === 0n` assertion after a rejected mint. For a value-bearing protocol this is the assertion you least want to lose.
3. `validator.test.ts` — `UNKNOWN_DEPLOYMENT` on MINT. Check exists at `validator.ts:80`, untested.
4. `validator.test.ts` — `UNKNOWN_DEPLOYMENT` on TRANSFER. Check exists at `validator.ts:129`, untested.
5. `validator.test.ts` — `UNSUPPORTED_ACTOR_SCRIPT` on DEPLOY. Check exists at `validator.ts:67`, tested only on MINT.
6. **Zero-amount rejection.** The old JSON parser caught `amt:"0"` as `INVALID_AMOUNT`. The binary decoder now accepts `amt=0` and defers to `validator.ts:86` `ZERO_AMOUNT` — which has **no test at either layer**.

Also restore: `indexer.test.ts` — "has a stable empty-state root."

---

## P1-9 — `reference-parser.ts` is not independent

**File:** `packages/protocol/src/cove/reference-parser.ts`
**Status:** READ.

It is advertised as "a deliberately INDEPENDENT, minimal second implementation ... the two implementations cannot share the same arithmetic bug."

It imports `COVE_DEPLOY_LEN`, `COVE_MINT_LEN`, `COVE_TRANSFER_LEN`, `OP_DEPLOY`, `OP_MINT`, `OP_TRANSFER` from `envelope.js`, and replicates the production control flow line-for-line — **including the same off-by-one** described in P1-10. A differential test against a copy of yourself proves nothing.

**Do this:** either make it genuinely independent (written from the spec document alone, importing nothing from `envelope.ts`), or delete it and stop describing it as a cross-check. Do not leave it as-is.

---

## P1-10 — envelope decoder off-by-one

**File:** `packages/protocol/src/cove/envelope.ts`
**Status:** READ.

Checks `data.length < 5` and then reads `data[5]`. A 5-byte payload `COVE\x01` yields `opcode === undefined`, falls through to `UNSUPPORTED_OPERATION` rather than `TRUNCATED`.

Validity is unaffected — both reject — but two implementations disagree on the reason code, and `reference-parser.ts` replicates the same bug so the differential test cannot catch it. Untested.

**Do this:** fix the bound to `data.length < 6`. Add a test asserting `TRUNCATED` for a 5-byte payload.

---

## P1-11 — no forward-compatibility rule is written down

**Status:** READ.

Unknown version or opcode produces `MALFORMED_COVE`, counted in `invalidOps`, state unchanged. That is the **right** behaviour, but it is nowhere in the spec, so a future V2 has no defined semantics for V1 indexers.

**Do this:** write the rule into the spec document explicitly. Add a test locking it.

---

## P1-12 — Bitcoin address fields accept any string

**File:** `packages/schemas/src/index.ts` — lines 32, 37, 42, 50, 55, 60, 72
**Status:** READ.

`walletAddress`, `sellerAddress`, `buyerAddress` are all `z.string().min(1)`. `tickerSchema` is the only field with a real regex.

**Do this:** add a proper address validator — bech32/bech32m checksum plus base58check — parameterised by the configured network. Reject a mainnet address on signet and vice versa.

**Test:** valid mainnet, valid signet, valid P2TR, wrong network, bad checksum, empty, and a random string.

---

## P1-13 — admin auth bypass, and the audit log is never written

**File:** `apps/web/src/app/api/admin/status/route.ts:9`
**Status:** READ.

```ts
if (config.nodeEnv !== "production" && !config.adminAuthSecret) return true;
```

The same bypass guards the **write** handler `PUT` at line 43, which flips `feature_flags` rows (lines 47-50).

Separately: **nothing writes to `admin_audit_logs`.** The table exists (`packages/db/src/schema.ts:334`), is created in the migration, is listed in `PRESERVED_TABLES` — and has zero writers. Every admin flag mutation is unlogged. `apps/web/src/app/admin/page.tsx:48-49` tells the user "All admin actions are recorded." That is false.

**Do this:**

1. Remove the bypass from the `PUT` handler entirely. Reads may keep it; writes may not.
2. Write an `admin_audit_logs` row on every flag mutation: who, what, from, to, when.
3. Either make the UI claim true, or remove the claim.

---

## P1-14 — no rate limiting anywhere

**Status:** VERIFIED — repo-wide grep for `rate.?limit|ratelimit|throttle|upstash|@vercel/kv|express-rate` returns **zero matches** across `apps/`, `packages/` and `docs/`.

`docs/RUNBOOK.md:23` claims "Redis backs cache + queue + mock-chain state and rate limits." There is no rate limiting.

Unauthenticated write endpoints with no throttle: `POST /api/report`, `POST /api/mint/quote` (inserts a row on every debounced keystroke), `POST /api/launch/build` (inserts into `tokens` + `token_metadata`), `POST /api/demo/reset` (see P0-4).

**Do this:** add rate limiting middleware backed by the Redis instance that already exists. Apply to every write endpoint. Then either make `RUNBOOK.md:23` true or correct it.

---

## P1-15 — `getUtxos` always returns empty, and there is no coin selection

**File:** `packages/bitcoin/src/provider.ts:160-163`
**Status:** READ.

```ts
async getUtxos(): Promise<ChainUtxo[]> {
  // Core RPC requires a wallet for listunspent; not used for indexing.
  return [];
}
```

The interface declares `getUtxos(scriptOrAddress: string)` (line 37); the implementation takes no argument and always returns `[]`. Any caller wiring this into coin selection gets zero UTXOs.

Separately: **there is no UTXO selection algorithm anywhere.** No accumulative-greedy, no branch-and-bound, no waste metric. Grep for `selectUtxo|coinSelect|selectCoins` returns zero hits. `buildUnsignedPsbt` takes already-chosen inputs.

**Do this:**

1. Either implement `getUtxos` against an address-indexed source (Esplora, or Core with an imported descriptor), or **remove it from the interface** so it cannot be mistaken for working.
2. Write a real coin selector, or document explicitly that input selection is the caller's responsibility.

**Do not leave a method that returns `[]` and looks implemented.**

---

## P1-16 — PSBT builder accepts several non-relayable transactions

**File:** `packages/bitcoin/src/psbt.ts:22-24, 88-93`
**Status:** VERIFIED.

All built without complaint:

- **Two OP_RETURN outputs.** Bitcoin Core rejects more than one (`TX_NULL_DATA` multiple).
- **A 203-byte OP_RETURN.** Core's `nMaxDatacarrierBytes` is 83.
- **A zero-input transaction**, fee 0.
- **`feeRateSatVb: 0n`** → fee 0.

**Do this:** throw on each. At most one OP_RETURN, at most 80 bytes of payload, at least one input, fee rate strictly greater than zero.

---

## P1-17 — `opReturnJson` corrupts binary envelopes

**File:** `packages/bitcoin/src/psbt.ts:114`
**Status:** VERIFIED — `434f564501fffe0080` round-trips as `434f564501efbfbdefbfbd00efbfbd`.

`Buffer.from(payload).toString("utf8")` is applied to the Cove envelope, which is **binary**. Lossy UTF-8 replacement. The field is also misnamed — there is no JSON any more.

**Do this:** rename to `opReturnHex` and emit hex. Update every consumer.

---

## P1-18 — dust thresholds are wrong for witness versions 2-16

**File:** `packages/bitcoin/src/dust.ts:25-31`
**Status:** VERIFIED — witness v2 and v16 return `573n`; Core returns `330`. A 73% over-estimate.

`isWitnessProgram` hardcodes only `0x00` (v0) and `0x51` (v1). Core's `CScript::IsWitnessProgram` accepts **any** version 0-16 with a 2-40 byte program.

The direction is conservative — it will not create a dust output — but it **rejects valid outputs** the network would accept, and `packages/protocol/src/cove/validator.ts:35-38` uses this to gate anchor validity.

Two lower-severity divergences:
- `dust.ts:65` uses `ceilDiv`; Core truncates (`nSatoshisPerK * nSize / 1000`), rounding up only when the result is exactly zero. Invisible at the default rate, off by one at any other. The comment at line 64 mis-states Core's behaviour.
- `dust.ts:55` returns `0n` for an empty script; Core's `IsUnspendable()` is false for an empty script and computes 471.

**Do this:** accept witness versions 0-16 with a 2-40 byte program. Match Core's truncation. Fix the empty-script case. Fix the comment.

**Note:** the three headline values (P2PKH 546, P2WPKH 294, P2TR 330) are **correct**, and the derivation faithfully mirrors `GetDustThreshold`. This file is the best work in the package — just extend it.

**Test:** add P2WSH, witness v2, witness v16, a witness v1 with a 20-byte program, and a non-default fee rate.

---

## P1-19 — `psbt.ts` has no direct tests

**Status:** READ.

The money-critical file has **zero** direct test coverage. `packages/protocol/src/cove/build.test.ts` gives indirect coverage through exactly the one configuration that works: `{script}` outputs, `network: "signet"`, P2WPKH inputs.

It never touches: P2PKH or P2TR inputs, `{address}` outputs, signing, fee-estimate accuracy, the change-folding path, or the fee reporting that lies.

**No BIP-174 official test vectors are used anywhere in the repository.**

**Do this:** create `packages/bitcoin/src/psbt.test.ts`. Cover the official BIP-174 vectors, plus a signed round-trip on regtest, plus every defect fixed in P0-1 through P0-10 as a regression test.

---

## P1-20 — raw script outputs bypass every network check

**File:** `packages/bitcoin/src/psbt.ts`, `packages/protocol/src/cove/build.ts:60, 95, 96, 115, 116`
**Status:** VERIFIED — a mainnet P2WPKH scriptPubKey passed as a raw `script` on a `network: "signet"` build is accepted silently.

`psbt.addOutput({address})` runs `toOutputScript(addr, net)` and correctly rejects a mainnet address on a signet build. But `cove/build.ts` passes **raw scripts for every protocol output**, and raw scripts carry no network information. The change address is the only output that gets checked. Inputs get no check at all.

Related: `decoder.ts:72-75` defaults `network` to `"signet"`, and `provider.ts:127` calls `decodeRawTransaction(raw)` with no network argument. `CoreRpcProvider` has no network field, so every transaction it decodes is decoded as testnet regardless of which node it is connected to.

**Do this:**

1. Add a `network` field to `CoreRpcProvider` and thread it into every `decodeRawTransaction` call.
2. Validate raw output scripts against the configured network where the script type allows it.
3. Make `btcNetwork` (`decoder.ts:14-17`) **throw** on an unrecognised network string instead of silently falling through to testnet. The fail-safe direction is right; the silence is not.

---

# P2 — HONESTY

These cost almost nothing and carry real credibility risk. Do them in one pass.

---

## P2-1 — the Cove spec documents a protocol the code does not implement

**Files:** `docs/COVE_PROTOCOL_V1.md`, `docs/COVE_V1_TEST_VECTORS.json`
**Status:** READ. Both last modified before the binary rewrite and unchanged since.

They specify: **JSON** envelopes, whole-token amounts, separate curve and fee outputs at vout 2 and 3, and no continuation output.

The code does: **fixed-width binary** envelopes, atoms, a combined settlement output at vout 2, and a required continuation output.

**Every test vector in `COVE_V1_TEST_VECTORS.json` is now invalid.** Anyone implementing from these documents builds a protocol this indexer rejects 100% of the time.

**Do this:** rewrite both to match the code. Include the exact byte layout:

```
DEPLOY   (10 bytes): [0..3] "COVE" | [4] ver=0x01 | [5] op=0x01 | [6..9]  tick (4x ASCII [0-9A-Z])
MINT     (26 bytes): [0..3] "COVE" | [4] ver=0x01 | [5] op=0x02 | [6..9]  tick
                     | [10..17] amountAtoms u64BE | [18..25] supplyBeforeAtoms u64BE
TRANSFER (18 bytes): [0..3] "COVE" | [4] ver=0x01 | [5] op=0x03 | [6..9]  tick
                     | [10..17] amountAtoms u64BE
```

Regenerate every test vector from the current implementation and wire them into the test suite so the document cannot drift again — the way `docs/CRC_LAUNCH_V1_TEST_VECTORS.json` is read directly by `packages/curve/test/mint-validation.test.ts`.

Also: `README.md` and `docs/ARCHITECTURE.md` do not mention Cove at all.

---

## P2-2 — `TRUST_MODEL.md` must state that Cove is client-validated

**File:** `docs/TRUST_MODEL.md`
**Status:** READ. **This is the most important item in P2.**

Cove is **client-validated**, exactly like CRC-20. Bitcoin validates two things: the signature on input 0, and that the outputs exist with those values. That is the complete list.

Bitcoin does **not** reject: a DEPLOY of a taken ticker, a MINT of 900,000,000 tokens, a MINT paying 1 sat, or a TRANSFER of tokens never owned. All of them confirm on-chain and are then ignored by the indexer.

`docs/PROTOCOL_VERIFICATION.md` already states the disqualifying judgement on CRC-20: *"Bitcoin does not independently reject an invalid CRC-20 mint/deploy/transfer, and the authoritative indexer is closed-source. This alone prevents enabling any mainnet write."*

Cove fixes the second clause — the indexer is in this repository and anyone can run it. **It does not fix the first clause at all.**

`TRUST_MODEL.md` currently lists "Attack classes rejected" without once saying that "rejected" means "ignored by our indexer," not "invalid on Bitcoin."

**Do this:** add an explicit, prominent section stating that Cove is client-validated, that Bitcoin does not enforce it, and that token supply is a claim made by whoever runs the indexer. Change every use of "rejected" to "rejected by the indexer" where that is what is meant.

**Also state plainly:** a transaction is only valid Cove if it pays the hardcoded treasury and settlement scripts in `cove/config.ts:42-46`. That makes Cove a payment-gated token standard with one beneficiary, not an open meta-protocol. That may be the intended design — but say so, because a Bitcoin reviewer will notice within a minute.

---

## P2-3 — three false claims in the product

| File | Claim | Reality |
|---|---|---|
| `apps/web/src/app/for-crc/page.tsx:63-64` | "The entire application is already built behind these interfaces. The missing part is a clean integration, not more product work." | Wallet, PSBT signing, signature verification and the Bitcoin provider are all incomplete or stubbed, and all are this project's work, not CRC's. |
| `apps/web/src/app/for-crc/page.tsx:33` | Discovery includes "search" | **No search exists.** Grep finds only `url.searchParams`. The homepage has exactly two sections. |
| `apps/web/src/app/mainnet/leaf/page.tsx:12` | Badge reads `LIVE MAINNET DATA` | Hardcoded fixtures. A disclaimer was added at lines 50-54 saying "not a live read" — so the badge and the footnote now contradict each other on the same page. |

**Do this:** correct all three. For the badge, use `ARCHIVED` or `RECORDED`.

---

## P2-4 — `THREAT_MODEL.md` and `RUNBOOK.md` describe controls that do not exist

**Status:** READ.

| Doc | Claims | Reality |
|---|---|---|
| `THREAT_MODEL.md:24` | `MAX_MINER_FEE_SATS` / `MAX_FEE_RATE_SAT_VB` mitigate fee manipulation | Dead config. See P0-3. |
| `THREAT_MODEL.md` | "PSBT substitution → re-decode + verify every output before signing and before broadcast" | No such verification exists. |
| `THREAT_MODEL.md` | "Bad RPC/provider → primary + fallback provider" | No fallback exists. |
| `THREAT_MODEL.md` | "Image/XSS payload → MIME sniffing, resize/re-encode, EXIF strip" | No image pipeline exists. S3 vars are declared with zero implementing code. |
| `RUNBOOK.md:23` | "Redis backs cache + queue + mock-chain state and rate limits" | No rate limiting. See P1-14. |
| `RUNBOOK.md:55` | "default 6 confirmations" | `protocol/config.ts` hardcodes 2; `.env` sets 2; `.env.example` sets 6. Three values for one knob. |

**Do this:** for each row, either implement the control or delete the claim. Reconcile the confirmation count to one value.

---

## P2-5 — `MAINNET_CHECKLIST.md` predates Cove

**File:** `docs/MAINNET_CHECKLIST.md`
**Status:** READ.

It still enumerates CRC-20 and marketplace items only. It does not mention Cove, the Bitcoin layer, PSBT signing, or the indexer.

**Do this:** rewrite it around the current architecture. Every item must be independently verifiable from code, not self-attested.

---

# P3 — HYGIENE

Do these last. They are real but nothing depends on them.

---

## P3-1 — three packages and one app have no tests

- `packages/config`, `packages/schemas`, `packages/wallets`, `apps/worker` — all `--passWithNoTests`.
- `apps/mock-crc-service` has **no `test` script at all**.
- `apps/worker`'s only real test (`reorg.integration.ts`) is a `tsx` script under `test:integration`, so it never runs in `pnpm test`.

**Do this:** write real suites for `packages/config` (the validation gates especially — they are security-critical and completely untested) and `apps/worker`. Wire `reorg.integration.ts` into `pnpm test`.

---

## P3-2 — `route-inventory.test.ts` tests nothing

**File:** `apps/web/src/route-inventory.test.ts:23-30`

All 11 "tests" are `expect(existsSync(file)).toBe(true)`. No handler is imported or invoked.

**Do this:** replace with tests that actually invoke the route handlers.

---

## P3-3 — e2e coverage is thinner than the count suggests

Of 22 passing e2e tests, **14 are screenshot smoke tests** whose only assertion is `expect(page.locator("main")).toBeVisible()` (`apps/web/tests/visual.spec.ts:19`). Only 4 real flows exist, run across 2 viewports.

Nothing covers: the marketplace (sell/buy/cancel and all 4 routes), graduation, or any error path — quote expiry, supply-changed, signer mismatch, fee-blocked. E2E-003 stops at the "Transaction submitted" toast and never checks that the balance or supply actually changed.

**Do this:** add real assertions to the mint flow, and cover the marketplace and at least the quote-expiry and supply-changed error paths.

---

## P3-4 — the graduation reserve does nothing

**File:** `packages/protocol/src/mock/chain.ts:525-533`
**Status:** READ.

160,000,000 tokens (16% of supply) are reserved for "graduation liquidity." `GRADUATION_RESERVE_ATOMS` is exported and **consumed by nothing**. The graduation step sets `status = "GRADUATED"` and emits an event — no mint, no allocation, no balance change.

**Do this:** decide what graduation actually does, implement it, and test it. Until then, remove the claim from any user-facing copy — a user minting under a "16% reserved for liquidity" promise is funding a reserve with no destination.

---

## P3-5 — the "atoms" naming mismatch was pushed downstream, not fixed

**Status:** READ.

`packages/curve` was fixed properly: `constants.ts:34-41` now defines real atom constants (`TOTAL_SUPPLY_ATOMS = 1e17`), `types.ts:6-8` splits `DisplayTokens` from `Atoms`, and `atoms.test.ts` locks both. Coverage is still 100%, and the full raise is unchanged at 24,196,788 sats.

**But the mismatch moved rather than vanished.** Database columns named `total_supply_atoms` / `public_supply_atoms` / `reserve_supply_atoms` are written with `*_TOKENS` values (`apps/worker/src/sync.ts:99-101`, `apps/web/src/app/api/launch/build/route.ts:89-91`) — 1e8 too small. `packages/protocol/src/types.ts:38` declares `reserveSupplyAtoms: DisplayTokens`. Meanwhile `apps/mock-crc-service/src/index.ts:158` and `canonical-mock.ts:111,177` multiply by `ONE_TOKEN` to expose real atoms at the API edge. The same concept is atom-denominated at the API and token-denominated in the database.

**Latent landmine:** `TOTAL_SUPPLY_ATOMS`, `PUBLIC_SUPPLY_ATOMS`, `GRADUATION_RESERVE_ATOMS`, `RESERVE_SUPPLY_ATOMS` and `PRICE_UNIT_ATOMS` **kept their exported names but changed value by 1e8** (`PRICE_UNIT_ATOMS` went 1e6 → 1e14). All current callers were migrated correctly, but any future import of those names gets a 1e8 error with **no type error to catch it** — both are `bigint`.

**Do this:** rename the database columns to match what they hold, or convert at the write boundary. Pick one and make it consistent end to end.

---

## P3-6 — remaining hardcoded values in the web app

| File | Value |
|---|---|
| `apps/web/src/app/api/protocol/status/route.ts:12` | `synced: true` hardcoded — the status dot can never go red |
| `apps/web/src/app/api/market/buy/build/route.ts:18` | `minerFee = 450n` |
| `apps/web/src/app/api/market/buy/build/route.ts:26-27` | `protocolFeeSats: 0n`, `platformFeeSats: 0n` — **no secondary-trading revenue at all** |
| `apps/web/src/lib/mint-service.ts:38-39` | 250 vbytes assumed for every mint |
| `packages/protocol/src/mock/adapter.ts:30` | `150 * inputs + 150 * outputs` |

The last two are the legacy estimates the new `psbt.ts` was meant to replace. **The production web path never reaches the new code** — `apps/web/src/app/api/launch/build/route.ts:45` calls the mock adapter, and lines 112-116 extract the txid by `JSON.parse(Buffer.from(psbtBase64, "base64"))`, assuming the mock's JSON-in-base64 format. Hand it a real BIP-174 PSBT and it throws.

**Do this:** wire the web app to the real PSBT builder, or explicitly document that the web app is mock-only until that work happens. Fix the marketplace fee model — there is currently no revenue path on secondary trading.

---

## P3-7 — smaller items

| File | Problem |
|---|---|
| `apps/web/next.config.mjs:26` | `remotePatterns: [{ protocol: "https", hostname: "**" }]` — the image optimizer will proxy any HTTPS host. SSRF and bandwidth-abuse surface. Restrict or remove. |
| `apps/web/next.config.mjs:17` | `experimental.serverComponentsExternalPackages` was removed in Next 15. Rename to `serverExternalPackages`. |
| `packages/bitcoin/src/psbt.ts:107` | Casts to the bitcoinjs private `__CACHE.__TX`. Works in 6.1.8; a patch bump silently breaks `unsignedHex`. The derived txid is correct — the access is not. Use a public API. |
| `packages/bitcoin/src/provider.ts:142` | `getPrevout` hardcodes `confirmations: 0`. Any depth policy reading this silently sees zero. |
| `packages/bitcoin/src/provider.ts:149-156` | `getTransaction` is a sequential N+1 — one `getrawtransaction` per input, awaited in series. |
| `apps/mock-crc-service/src/index.ts:186` | `server.listen(PORT)` with no host binds `0.0.0.0`, and every endpoint is unauthenticated. Bind to `127.0.0.1`. |
| `packages/curve/src/mint-validation.ts:35` | `validateCanonicalMint` is still dead code — cited in `CRC_LAUNCH_V1_PROPOSAL.md:127` as the normative reference, consumed only by its own test. It also **contradicts** the running validator on overpayment: the proposal and test vectors say overpayment is valid; `validateExactOutputs:62` rejects it. Reconcile or delete. |
| Repo root | `.turbo/*.log` and `coverage/` are committed. Stale build artifacts in version control. Add to `.gitignore`. |

---

# Confirmed safe — do not "fix" these

Verified during the audit. Leave them alone.

- **`.cove-signet-keys.json` was never committed.** `git log --all -- .cove-signet-keys.json` is empty; no secret-bearing file appears anywhere in history. It is correctly gitignored (`.gitignore:39`). Keep it that way.
- **`packages/bitcoin/src/dust.ts` headline values are correct** — P2PKH 546, P2WPKH 294, P2TR 330, P2WSH 330 — and the derivation faithfully mirrors Core's `GetDustThreshold`. Extend it (P1-18); do not rewrite it.
- **`estimateInputVsize` is correct** — P2WPKH 68, P2TR 58, P2PKH 148, all verified against real weight math. Only the *output* estimate is broken.
- **`parseCanonicalOpReturn` (`decoder.ts:130-146`) is correct and fully bounds-checked.** It rejects non-minimal PUSHDATA1 and all PUSHDATA2/4. The loose-gate / strict-accept shape is the right design.
- **`outputAddress` (`decoder.ts:54-66`)** special-cases key-path P2TR to bech32m directly to avoid needing the ECC library. Correct and deliberate.
- **`decoder.test.ts` uses real signet chain data** — two real transactions with exact txids, values and addresses asserted. Genuinely good tests.
- **`requireSignet()` (`cli.ts:45-50`)** is the strongest network control in the system. Keep it, and add an equivalent for any new consumer.
- **`COVE_V1_MAINNET_GENESIS_HEIGHT` is `null`** with "Mainnet is NOT activated." Correct. Do not set it.
- **Economics are recomputed from the frozen integer table and never read from the payload.** This "validate, don't trust" discipline survived the rewrite intact. Preserve it in every change.
- **`packages/curve` is at 100% coverage with 72 passing tests, and the full raise is unchanged at 24,196,788 sats.** Do not refactor it without a failing test first.
- **All mainnet write flags default to `false`, and `CRC_PROTOCOL_VERIFIED` defaults to `false`.** Do not change any default. Do not set `CRC_PROTOCOL_VERIFIED=true`.

---

# Definition of done

Before reporting this plan complete:

```bash
pnpm typecheck   # green
pnpm lint        # green, with eslint.ignoreDuringBuilds removed
pnpm test        # green, with no --passWithNoTests masking an empty suite
pnpm build       # green
pnpm test:e2e    # green
```

Plus:

- [ ] Every P0 item closed, each with a regression test that fails without the fix.
- [ ] `psbt.test.ts` exists and includes the official BIP-174 vectors.
- [ ] The Cove state root is order-independent, and there is a test proving it.
- [ ] A conservation invariant runs after every applied operation.
- [ ] `docs/COVE_PROTOCOL_V1.md` matches the implementation, and its test vectors are executed by the suite.
- [ ] `docs/TRUST_MODEL.md` states plainly that Cove is client-validated.
- [ ] No documented control exists that the code does not implement.
- [ ] `CRC_PROTOCOL_VERIFIED` is still `false`.

---

# Discovered during remediation

_Append anything found while working. Do not silently expand scope._

## Completed (remediation pass, items 1-8)

- Item 1: demo/reset now requires a real admin bearer token (no dev bypass), a
  non-production env, and mock network; returns 404 when unavailable.
- Item 2: `apps/web/src/lib/env.ts` calls `validateConfig` (fail closed).
- Item 3: `treasuryAddress` throws instead of returning ""; config address check
  extended to every non-mock network (stricter bech32/base58 regexes).
- Item 4: demo-reset/reindex refuse non-mock; worker seeds only in mock;
  `resetProjections(db, network)` deletes per-network instead of truncating all.
- Item 5: TRUST_MODEL now states Cove is client-validated and payment-gated.
- Item 6: for-crc claim corrected + "search" removed; LEAF badge → ARCHIVED.
- Item 7: THREAT_MODEL/RUNBOOK reconciled; dead MAX_*_FEE env vars deleted;
  finality confirmations unified to 6.
- Item 8: psbt no-op check replaced with a real two-source output-sum check;
  admin PUT lost its dev bypass and now writes admin_audit_logs rows.

Discovered while working: the prior testnet-address regex `/^(tb1|[mn2])/` matched
arbitrary garbage beginning with "m"/"n"/"2" (e.g. "not-an-address"); replaced
with anchored bech32/base58 regexes. No other new defect found.
