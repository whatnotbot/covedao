# PRE-MAINNET SAFETY PATCH

**Baseline:** `fe9d94f74dbe98f32178e5f509530700d256eb8e`
**Generated:** 2026-09-23, from three independent audits of the ~3,400 lines added since `docs/FIX_PLAN.md`.

**Do not add features.** Every item below closes a hole that already exists.

---

## Rules

1. Work **in order**. S-items before A-items before B-items.
2. After **every** numbered item: `pnpm typecheck && pnpm lint && pnpm test` — all green before moving on.
3. **Never delete or weaken a test to make a suite pass.** If a test fails, say whether the code or the test is wrong, then fix that one.
4. **Never use `--passWithNoTests`** to hide a missing suite.
5. Every fix needs a test that **fails before** your change and **passes after**.
6. **Mainnet stays unactivated.** Do not set any `COVE_*_MAINNET_ENABLED`. Do not set `COVE_V1_MAINNET_GENESIS_HEIGHT`. Do not populate owner addresses. Do not broadcast to mainnet.
7. If an item is blocked, **stop and report**. Do not work around it.
8. Append anything newly discovered to "Discovered during this patch" at the bottom. Do not silently expand scope.

Status legend: `PROVEN` = an auditor executed a proof-of-concept. `READ` = confirmed at the cited line.

---

# S — SIGNING AND KEYS

Worst first. S-1 is the most dangerous defect found in this repository to date.

## S-1 — `signPsbt` signs anything it is given

**File:** `packages/bitcoin/src/signer.ts:60-76`
**Status:** PROVEN — a hostile PSBT sweeping 100% of the UTXO to an attacker address, with no change output, was signed without complaint.

There is **zero validation of PSBT outputs** before signing. No amount check, no destination check, no change check, no fee check. Then `finalizeAllInputs()` at line 74 finalizes every input — including inputs this key never signed.

This is exported as a general `WalletSigner` from `packages/bitcoin/src/index.ts:41`. Any PSBT reaching it from a server endpoint, a compromised indexer, or a MITM'd Esplora response is signed unconditionally.

The proof scripts do not save you: they sign **first** and validate **after** (`signet-proof.ts:360-362`, `mutinynet-proof.ts:238-240`). And `validatePure` checks Cove protocol semantics and fee caps — it would **not** catch a redirected change output.

**Do this:**

1. Change the `signPsbt` signature to require the caller's intent:

```ts
signPsbt(psbtBase64: string, expected: {
  outputs: ReadonlyArray<{ scriptPubKeyHex: string; valueSats: bigint }>;
  maxFeeSats: bigint;
  changeScriptPubKeyHex?: string;
}): string
```

2. **Before** any call to `signInput`, decode the PSBT and assert:
   - `psbt.txOutputs.length === expected.outputs.length`
   - each output's script and value match `expected.outputs[i]` exactly, **in order**
   - if a change output is declared, its script equals `expected.changeScriptPubKeyHex`
   - `totalIn - totalOut <= expected.maxFeeSats`

   Throw with a message naming the first mismatched output index. Do not sign on any mismatch.

3. Do **not** call `finalizeAllInputs()`. Finalize only the inputs this key signed.

4. Update every caller to pass its intent: `signet-proof.ts`, `mutinynet-proof.ts`, `regtest-reorg.ts`.

**Test:** reproduce the auditor's proof-of-concept as a regression test — a PSBT paying an address the caller did not ask for must throw, and must throw **before** any signature exists. Also cover: wrong amount, extra output, missing output, reordered outputs, fee over cap.

**Acceptance:** it is not possible to obtain a signature for outputs the caller did not explicitly declare.

## S-2 — the web wallet has the same defect, user-facing

**Files:** `apps/web/src/app/launch/page.tsx:67`, `apps/web/src/components/MintButton.tsx:118`, `apps/web/src/components/MarketSection.tsx:58`
**Status:** READ.

Each takes a PSBT from the server and hands it straight to `signPsbt`. A malicious or compromised backend returns a PSBT paying an attacker, and the user's wallet signs it.

The adapter is currently `mock` (`WalletProvider.tsx:57`), so nothing is at risk today. But the pattern is wired end to end, and the real wallet adapter will inherit it.

**Do this:** at each of the three call sites, decode the returned PSBT client-side and verify every output against what the user actually requested — the amount they typed, the treasury/settlement addresses from config, their own change address — **before** calling `signPsbt`. Show the user what they are signing. Never sign a PSBT whose outputs the client cannot independently reconstruct.

**Test:** assert each flow rejects a PSBT with a tampered output.

## S-3 — sighash protection is accidental, and the rejection is swallowed

**File:** `packages/bitcoin/src/signer.ts:68-71`
**Status:** PROVEN.

`psbt.signInput(i, this.keyPair)` passes no sighash whitelist. `SIGHASH_ALL` is enforced only by bitcoinjs-lib 6.1.8's internal default. It happens to work — but a **bare `catch {}` at line 69 swallows the rejection**, so a genuine `SIGHASH_NONE` attack surfaces as `"Can not finalize input #0"`, indistinguishable from a routine failure.

**Do this:**
1. Pass `[bitcoin.Transaction.SIGHASH_ALL]` explicitly as the third argument to `signInput`.
2. Remove the bare catch. Let the error propagate with its real message.

**Test:** assert a `SIGHASH_NONE` PSBT throws with a message that names the sighash type.

## S-4 — `tapInternalKey` is the wrong key

**File:** `packages/bitcoin/src/psbt.ts:129-130`
**Status:** PROVEN.

```ts
tapInternalKey: script.subarray(2)
```

For a P2TR script `OP_1 <32-byte key>`, `subarray(2)` is the **tweaked output key Q**, not the internal key **P**. Per BIP-341, `Q = P + H_TapTweak(P‖m)·G`. The auditor confirmed `P !== subarray(2)`.

**P is not recoverable from a scriptPubKey.** This field can never be filled correctly from a UTXO alone.

Second bug at line 130: it sets `SIGHASH_ALL` on taproot inputs, but bitcoinjs-lib's taproot path defaults to `SIGHASH_DEFAULT` and rejects `SIGHASH_ALL`.

**This fails closed today** — there is no taproot signing code anywhere in the repo, and `LocalP2WPKHSigner` is ECDSA-only. The danger is `packages/bitcoin/src/psbt.test.ts:144`, which asserts only `toBeDefined()`. That makes a wrong field look validated. A future taproot signer trusting it derives the wrong output key.

**Do this:**
1. Require the caller to supply the true internal key. Add it to `ChainUtxo` or to a taproot-specific input type. If the caller cannot supply it, **throw** rather than setting a wrong value.
2. Use `SIGHASH_DEFAULT` for taproot inputs.
3. Fix `psbt.test.ts:144` to assert the actual expected key bytes, not `toBeDefined()`.

## S-5 — rotate the signet keys

**File:** `.cove-signet-keys.json`
**Status:** READ. **Partially handled — permissions already corrected to `0600`.**

This file held two plaintext signet WIFs at mode `0644` — world-readable by every local user and process, including any npm postinstall script or backup agent — from 2026-09-23 12:59 until now.

It was correctly gitignored and an exhaustive scan of every blob in every commit confirms it **never entered git history**.

**Do this:**
1. **Rotate both keys.** They were world-readable for hours. Treat them as disclosed.
2. Make the code that writes this file use `{ mode: 0o600 }`, matching `.cove-owner-signer.wif` and `.cove-signer-b.wif`, which already do this correctly.

Signet coins are worthless — this is about the habit, not the funds.

## S-6 — one key signs two different chains

**Files:** `signet-proof.ts:33-34`, `mutinynet-proof.ts:29-30`
**Status:** READ.

`.cove-owner-signer.wif` is hardcoded as both `EXPECTED_SIGNER_ADDRESS` (signet) and `SIGNER_A` (mutinynet). `.cove-signer-b.wif` is shared the same way. Both addresses are `tb1…`, so they are visually indistinguishable.

`signet-proof.ts:291` asserts `info.chain === "signet"`. **`mutinynet-proof.ts` has no chain assertion at all** — it trusts a hardcoded URL.

Note: `chain === "signet"` cannot distinguish default signet from Mutinynet or any custom signet. They all report `"signet"`.

**Do this:**
1. Separate key files per chain. Never share a WIF across networks.
2. Add a chain assertion to `mutinynet-proof.ts` — assert the **genesis block hash**, not the `chain` string, since the string cannot distinguish signets.
3. Apply the same genesis-hash assertion in `signet-proof.ts` and `cli.ts:50-55`, replacing or supplementing `requireSignet`.
4. `scriptOf()` hardcodes `networks.testnet` at `signet-proof.ts:254` and `mutinynet-proof.ts:49`. Use `signer.getNetwork()`.

## S-7 — `btcNetwork` silently defaults to testnet

**File:** `packages/bitcoin/src/decoder.ts:17-18`
**Status:** READ.

An unrecognised network string falls through `default:` to `networks.testnet`. The fail-safe direction is right; the silence is not. `NetworkName` is compile-time only, so a runtime string bypasses it.

**Do this:** make the switch exhaustive and **throw** on an unknown network.

---

# A — MAINNET ACTIVATION

## A-1 — the mainnet gates are in a package the mainnet code never loads

**Status:** READ. **This is the headline finding of the activation audit.**

`packages/cove-indexer` **does not import `@crclaunch/config`**. Verified: zero matches for `crclaunch/config`, `loadConfig`, `validateConfig`, `coveFlags` across `packages/cove-indexer/src/*.ts`. The dependency is declared at `cove-indexer/package.json:29` and unused.

Therefore **none** of these are read by the only process that can broadcast to mainnet:
- `COVE_MAINNET_ENABLED`, `COVE_DEPLOY/MINT/TRANSFER_MAINNET_ENABLED` (`load.ts:90-93`)
- `validateConfig`'s canary requirement (`load.ts:177-184`)
- `isCoveMainnetCanaryComplete` (`load.ts:143-159`)
- `coveMainnetActivationStage` (`flags.ts:17-26`)

`coveMainnetActivationStage` and `isCoveMainnetCanaryComplete` have **zero non-test callers anywhere**.

What actually prevents a mainnet broadcast today is the absence of a funded UTXO and an external signature. Economics, not code.

**Do this:** in `mainnet-canary.ts`, before constructing any mainnet config (before line 299):

```ts
const config = loadConfig(process.env);
validateConfig(config);
assert(config.coveFlags.mainnetEnabled, "COVE_MAINNET_ENABLED must be true");
assert(isCoveMainnetCanaryComplete(config), "canary proof incomplete");
```

**Test:** assert the canary refuses to run with the flags at their current defaults.

## A-2 — consensus configuration must be committed constants, not env

**Files:** `packages/protocol/src/cove/config.ts:45`, `mainnet-canary.ts:286-297`
**Status:** READ.

`COVE_V1_MAINNET_GENESIS_HEIGHT` at `config.ts:45` is exported and **imported by nothing**. Zero importers. It is decorative — exactly like `genesisHeight` in the earlier audit. Every functional reference is to the *environment variable* of the same name, read independently in two places (`load.ts:95` and `mainnet-canary.ts:294`) that never cross-check each other.

Consensus values in env means two indexers with different `.env` files silently disagree and both believe they are correct.

**Do this:**

1. Create a committed `COVE_V1_MAINNET_CONFIG` holding `genesisHeight` (H), `treasuryScript` and `settlementScript` as **immutable literal constants**, alongside the existing signet config. Leave the owner values as an explicit unset sentinel until the owner supplies them — the config must **throw** if used while unset, never fall back to a default.

2. Runtime env may **verify** these values. It must not **define** them. On any mismatch between env and constant, **exit non-zero**. "Verify" must mean "refuse to run" — a warning is decoration.

3. Delete the decorative `COVE_V1_MAINNET_GENESIS_HEIGHT` constant at `config.ts:45`, or make it the real source of truth. Do not leave both.

4. Add frozen state-root vectors for the mainnet domain, mirroring `state-root-vectors.json` for signet.

**Also:** `MAINNET_FEE_CAPS` (`config.ts:25-31`) has **zero test references**. Someone could change mainnet `launchFeeSats` from 10,000 to 10,000,000 and no test would fail. Add vectors that pin every mainnet economic constant.

**Test:** assert the canary throws when env and constant disagree, and when owner values are unset.

## A-3 — the canary proof is six typed strings

**File:** `packages/config/src/load.ts:143-159`
**Status:** READ.

`isCoveMainnetCanaryComplete` performs six regex tests (`TXID_RE = /^[0-9a-f]{64}$/`, `load.ts:137`) and one string equality. It never:
- queries mainnet for those txids
- recomputes or verifies the state root
- compares against `.cove-mainnet-canary.json`
- checks the activation height against the chain

The `stateRoot === replayRoot` check at line 157 is satisfied by typing the same string twice. **Your own test proves this** — `load.test.ts:14-21` passes with `"a".repeat(64)`.

**Do this:** verify the proof against the chain and against the manifest, not against a regex. At minimum: each txid must exist on mainnet at the recorded height, and the recorded state root must be recomputed from those blocks.

If chain verification is out of scope for this patch, then **say so in the code and the docs** — rename the function to `isCoveMainnetCanaryAsserted` so nobody mistakes a self-attestation for a proof.

## A-4 — the two stages are not sequential

**File:** `packages/config/src/flags.ts:22`
**Status:** READ.

```ts
const anyCoveFlag = config.coveFlags.mainnetEnabled || anyPublic;
```

Setting `COVE_DEPLOY_MAINNET_ENABLED=true` alone — with `COVE_MAINNET_ENABLED` still `false` — reaches `PUBLIC_WRITES` directly. `OWNER_CANARY` is never a prerequisite. `validateConfig` applies the **identical predicate** to both stages (`load.ts:177`). There is no ordering, no ratchet, no record that stage 1 happened.

`load.test.ts:132-135` codifies this as intended behaviour.

**Do this:** make stage 2 require stage 1. Public writes must be unreachable unless `mainnetEnabled` is true **and** the canary proof is present. Update `load.test.ts:132-135` — the current test asserts the hole is correct.

## A-5 — the Esplora endpoint defaults to real Bitcoin

**File:** `packages/cove-indexer/src/mainnet-canary.ts:48`
**Status:** READ.

```ts
const ESPLORA = process.env.COVE_MAINNET_ESPLORA_URL || "https://blockstream.info/api";
```

Missing configuration resolves **toward** real money. `signet-proof.ts:32` uses the same pattern with a signet fallback — same code, opposite risk polarity.

`COVE_MAINNET_ESPLORA_URL` is the one mainnet var whose **absence is riskier than its presence**.

**Do this:** require it explicitly. `requireEnv("COVE_MAINNET_ESPLORA_URL")` — no fallback.

## A-6 — the chain check is optional and guards the wrong connection

**File:** `packages/cove-indexer/src/mainnet-canary.ts:419-437`
**Status:** READ. **This is the user's item 2, and the defect is worse than stated.**

Two problems:

1. The `assert(info.chain === "main")` and `testmempoolaccept` block at lines 421-424 sits inside `if (RPC_URL)`. `COVE_MAINNET_RPC_URL` is absent from `.env`, so the `else` at 426-428 fires and prints a warning. **The safety check is opt-in.**

2. Even when it runs, it validates against the **Core RPC host** while the broadcast at line 437 goes through the **Esplora host**, which is never chain-verified. Verify on host A, send to host B.

`EsploraChainProvider` has **no chain-identity method at all** — no `getBlockchainInfo`, no genesis hash check. The `network` constructor argument is used only for local decoding.

**Do this:**
1. Make Bitcoin Core **mandatory** for `--confirm-mainnet`. `requireEnv("COVE_MAINNET_RPC_URL")`. If Core is absent, **broadcasting is forbidden** — exit non-zero.
2. Assert `chain === "main"` **and** the mainnet genesis block hash, unconditionally.
3. **Broadcast through Core**, not Esplora — so the host that validated is the host that sends. If Esplora must remain a fallback, chain-verify it by genesis hash first.
4. `testmempoolaccept` must pass before broadcast. A failure is fatal.

## A-7 — harden canary resume

**File:** `packages/cove-indexer/src/mainnet-canary.ts:403`
**Status:** READ. **This is the user's item 3.**

```ts
if (step.expectedTxid && step.expectedTxid !== txid) { throw ... }
```

`.cove-mainnet-canary.json` does not currently exist. On a fresh run with `COVE_MAINNET_SIGNED_TX` already set, `stepOf` creates an empty object via `??=` (line 114), `step.expectedTxid` is `undefined`, the `&&` short-circuits, and **the binding check never runs**. Any externally supplied transaction with a valid Cove envelope, resolvable prevouts and acceptable fees is broadcast.

**Do this:**
1. **Persist the locally-derived txid and the signed raw transaction *before* broadcasting.** Not after.
2. Make the txid binding **unconditional** — require `step.expectedTxid` to exist. If it does not, refuse to broadcast.
3. On restart, **resolve any recorded unconfirmed transaction** in the mempool or chain before doing anything else.
4. **Never construct a replacement while a recorded step is unresolved.**
5. **Reject** any mismatch between an existing manifest and the current ticker, H, treasury, settlement, actor or recipient. Do not overwrite — throw.

**Also fix:** `decideNextAction` (`proof-manifest.ts:59-61, 77, 84`) returns a `reason` string saying *"resolve before re-broadcast"*, and **nothing reads it**. Every caller branches on `action` only (`signet-proof.ts:354-355, 373, 391`; `mutinynet-proof.ts:233-234, 248, 263`). Make it a distinct action — `BLOCKED_UNRESOLVED` — that halts the loop. `proof-manifest.test.ts:97-101` currently locks in the hole; update it.

**Also fix:** `proof-manifest.ts:81` returns `DONE` only on exact balance equality. Any deviation makes it permanently unsatisfiable while each loop iteration reduces the balance further — and `signet-proof.ts:354` / `mutinynet-proof.ts:233` cap **neither iterations nor cumulative fees**. Add both caps.

## A-8 — "future-height activation" is unenforced

**File:** `packages/cove-indexer/src/mainnet-canary.ts:294-304`
**Status:** READ.

Only `H >= 1` (line 297) and `tip >= H` (line 304) are checked. **A past height is accepted.** Nothing distinguishes an H committed a month ago from one typed thirty seconds ago — there is no signature, no hash, no on-chain anchor.

A past H is also silently catastrophic for a different reason: `finalize` replays every block from H to tip, fetching every transaction hex one HTTP request at a time (`esplora.ts:96-99`). A past H means hundreds of thousands of blocks. It fails by timeout, not by check.

**No off-by-one was found** — block H is correctly the first indexed block, consistently across `:329`, `:330`, `:443` and `:470`.

**Do this:** enforce that H is in the future at the moment it is committed to the constant (A-2), and assert `H > tip` at commit time. Reject a past H with a clear message.

---

# B — NETWORK, PERSISTENCE, REORG

## B-1 — the reorg test is a tautology

**File:** `packages/cove-indexer/src/regtest-reorg.ts:288-298`
**Status:** READ. **This is the user's item 4, and the root problem is deeper than the mempool.**

```ts
const recovered = new CoveIndexer(CFG);
await indexAndPersist(provider, store, recovered, genesis, newTip);
const recoveredRoot = recovered.getStateRoot();   // ← read from MEMORY

const clean = new CoveIndexer(CFG);
await indexRange(provider, clean, genesis, newTip);
const cleanRoot = clean.getStateRoot();            // ← read from MEMORY

assert(recoveredRoot === cleanRoot);
```

`indexAndPersist` and `indexRange` are the **same fold**; the former additionally writes to Postgres. Both roots come from a fresh in-memory `CoveIndexer` over the same range. **Postgres is written and never read back into the comparison.**

This can only fail if `bitcoind` returns non-deterministic bytes. A regression that broke reorg recovery entirely would leave it green.

The same pattern repeats at `:266-268` and at `store.integration.ts:92-106`. And `indexer.test.ts:104-122`, titled `"reorg rebuild is deterministic"`, contains no reorg at all.

**Do this:**

1. **Read `recoveredRoot` out of Postgres**, not out of the in-memory indexer. That single change makes the assertion meaningful.
2. Construct a reorg where a transaction genuinely does **not** survive the branch switch. Currently `invalidateblock` returns the TRANSFER to the mempool and `generateToAddress` immediately re-mines it, so nothing is ever actually reverted.
3. Then assert the user's required post-conditions:
   - DEPLOY present
   - MINT present
   - **TRANSFER absent**
   - supply = 2,000,000
   - A balance = 2,000,000
   - B balance = 0
   - recovered root == clean replay root, **with the recovered root read from the database**
4. Test a reorg deeper than 1 block. Current depth is 1.
5. Rename `indexer.test.ts:104-122` to what it actually tests, or make it a real reorg test.

**On clearing the mempool:** clearing it proves the weaker property — *"a TRANSFER that was never re-broadcast stays absent."* Real reorgs do not clear mempools. Prefer keeping the mempool and asserting that the final root equals a clean replay of the real chain even when the TRANSFER **is** re-mined. Use the mempool clear only if the stronger version proves impossible in CI, and **state in a test comment which property you proved**.

## B-2 — there is no reorg recovery, only a full wipe

**File:** `packages/cove-indexer/src/cli.ts:259-266, 275-284`
**Status:** READ.

The entire reorg response is `clearCove()` then re-index from genesis. There is no rollback, no undo, no common-ancestor walk, no disconnect-block path.

The `canonical` boolean exists on `cove_blocks`, `cove_operations`, `cove_tokens` and `cove_balances` — and is **only ever written `true`** (`store.ts:24, 164`). Nothing in the repo ever sets it false.

This is a **regression against code you already have**: `apps/worker/src/sync.ts:37` walks to the common ancestor, `packages/db/src/repo.ts:225, 574, 588, 602` mark rows non-canonical, and `apps/worker/src/reorg.integration.ts:210-245` does a depth-3 reorg and asserts orphans are removed.

Worse: `clearCove()` and the rebuild are **not in a transaction** (`cli.ts:261-263`). Between them the database holds no Cove data, with no in-progress flag. Any reader sees empty balances as authoritative.

**Do this:**
1. Port the common-ancestor walk from `apps/worker/src/sync.ts:37`.
2. Actually use the `canonical` column — mark orphaned rows false rather than truncating.
3. Add indexes on `cove_operations.blockHeight` and `cove_blocks.hash`. Both are needed by any rollback and neither exists.
4. Until rollback lands, add an in-progress flag so readers can tell a rebuild from an empty state.

## B-3 — Esplora trusts whatever it is told

**File:** `packages/bitcoin/src/esplora.ts:85-101`
**Status:** READ. **A regression — the Core provider got this fix and Esplora did not.**

`provider.ts:120-125` verifies the block hash matches the request and the merkle root matches the transactions. `esplora.ts:93-101` does **neither**. It takes the caller's hash, fetches a txid list, and returns it as canonical. A hostile or buggy host can return an arbitrary txid list for any hash and the indexer folds it into the state root.

`mainnet-canary.ts` uses this provider for block data **and** for the mainnet broadcast.

Additional defects:
- `getBestHeight` (`:85-87`) is `parseInt` with **no `NaN` check**. An HTML error page served with HTTP 200 yields `NaN`; every indexing loop becomes a no-op and reports a clean empty state root as success.
- `getBlockHash` (`:89-91`) returns raw text with no 64-hex validation.
- Every response is a bare `as T` cast with no schema check.
- **No retries or backoff anywhere** in `esplora.ts`.
- No response size limits.
- `EsploraChainProvider` silently omits `getBlockchainInfo`, `testMempoolAccept` and `estimateFeeRate` from the `BitcoinChainProvider` interface — so TypeScript never surfaced the gap.

**Do this:**
1. Mirror `provider.ts:120-125` — verify the block hash and the merkle root.
2. `NaN` guard on `getBestHeight`. Throw, never return `NaN`.
3. Validate `getBlockHash` output as 64 hex characters.
4. Add retries with backoff for read calls only — never for broadcast.
5. Make `EsploraChainProvider` implement the full interface, or explicitly declare a narrower one.

**Also:** `provider.ts:120-125` — the Core fix itself — is **untested**. `provider.test.ts` covers only two pure helpers. Add tests for both providers.

## B-4 — the worker will crash-loop on its first bad day

**File:** `packages/cove-indexer/src/cli.ts:291`
**Status:** READ.

`scanAndPersist` has no retry wrapper. One transient error from the public RPC node propagates to the top-level catch and the **process exits**. On restart it replays from `GENESIS = 323323` in memory — tens of thousands of sequential calls to the same public node, which rate-limits, causing another exit.

The cursor check at `:267-274` correctly retries `getBlockHash`. The scan path did not get the same treatment.

**Do this:** wrap the scan in the same retry-with-backoff, and persist progress so a restart resumes from the cursor rather than from genesis.

## B-5 — sync is quadratic and will not finish

**Files:** `packages/cove-indexer/src/cli.ts:203`, `store.ts:167-237, 257-265`
**Status:** READ.

On **every block**, `persistBlock` receives `indexer.getEvents()` — the full cumulative event list since genesis — and issues one upsert per event (`store.ts:167-184`). Same for every token (`:186-201`) and every balance (`:203-221`). Indexing B blocks with E events issues roughly B×E upserts.

Plus a **full `SELECT` of `cove_balances`** on every block (`:222-225`) to compute the prune set, then a separate `DELETE` per orphan.

Plus `getLatestCheckpoint` (`:257-265`) does `SELECT *` with **no `LIMIT` and no `DESC`**, then `.at(-1)` in JavaScript — against a table that gains a row per block forever with no pruning.

**Do this:**
1. Persist **deltas**, not the full state, per block.
2. Replace the per-block full scan with a targeted query.
3. `getLatestCheckpoint` → `ORDER BY height DESC LIMIT 1`.
4. Prune old checkpoints.
5. Bound `CoveIndexer.events` and `seenTxids` (`indexer.ts:59-60`), which grow unbounded for the process lifetime.

## B-6 — the Mutinynet broadcast has a double-spend window

**File:** `packages/cove-indexer/src/mutinynet-proof.ts:211-215`
**Status:** READ.

It broadcasts, then writes the manifest at `:241`. No `testmempoolaccept` substitute, no try/catch, no ambiguity handling, and the Esplora-returned txid is discarded without comparison to the locally derived one.

A 20-second timeout on an **accepted** transaction throws before the manifest write is reached. On the next run, `decideNextAction` sees no recorded txid and builds a **second, different** transaction spending the same input.

`signet-proof.ts:211-226` `broadcastSafely` already does this correctly: derive txid locally → `testMempoolAccept` → broadcast → on transport error, re-query the **exact** txid rather than rebuilding.

**Do this:** give `mutinynet-proof.ts` the `broadcastSafely` treatment, and write the manifest **before** broadcasting (see A-7).

## B-7 — the replay guard is memory-only

**Files:** `packages/cove-indexer/src/indexer.ts:60, 109-114`, `store.ts`
**Status:** READ.

`seenTxids` is a process-local `Set`, rebuilt empty on every construction. The persistence layer has **no replay guard at all** — what exists is upsert idempotency plus the fact that `persistBlock` writes a full snapshot.

The reason a double-apply cannot currently recur is that **state is never loaded back from the database**. There is no `loadState`. The database is a write-only projection. The moment anyone adds a load fast-path, there is no persistence-layer guard.

**Do this:** enforce the replay guard at the persistence layer, keyed on `(network, txid)`, before any `loadState` is written.

## B-8 — CI gates nothing that matters

**File:** `.github/workflows/cove-regtest.yml`
**Status:** READ.

It is the **only** workflow in the repo. It runs exactly one command: `pnpm --filter @crclaunch/cove-indexer regtest-reorg` (`:83`).

Your **283 unit tests, `lint`, `typecheck` and `build` run in no CI job at all.**

With a single non-required workflow, nothing blocks a merge, and `[skip ci]` skips it.

**Do this:**
1. Add a workflow running `pnpm typecheck && pnpm lint && pnpm test && pnpm build` on every push and pull request.
2. Keep the regtest job.
3. Document which checks must be required in branch protection (that setting lives in GitHub, not the repo — note it in the README so it is not forgotten).

The bitcoind download with `sha256sum -c` against a pinned digest (`:36, :58`) is **done well**. Keep it.

## B-9 — smaller items

| File | Problem |
|---|---|
| `store.ts:18-47` | `saveBlock`/`saveOperations` are **not transactional** and are dead in production — only `store.integration.ts` calls them. So the integration test exercises a non-production path. Delete them, or make the integration test use `persistBlock`. |
| `mutinynet-proof.ts:28` | Esplora URL is **hardcoded**, not env-overridable. Every other provider URL is. |
| `regtest-reorg.ts:3` | Reads `DATABASE_URL` from the repo-root `.env` with no gate. Running it locally writes to whatever that points at. `clearCove` is network-scoped so it will not delete signet rows, but it still connects. |
| `regtest-reorg.ts:40-42` | RPC credentials default to `user`/`pass`. Fine for ephemeral CI, risky as a local default. |
| `esplora.ts:130` | `getPrevout` fires an extra `getBestHeight()` HTTP call **per prevout**. |
| `proof-manifest.ts` | `ProofStep.blockHash` is written as `""` at every call site. Dead field. |
| `esplora.ts:57` | `EsploraTxJson.vin` declared and never used. |
| `.env` vs `.env.example` | `QUOTE_TTL_BLOCKS` is `120` in `.env` and `2` in `.env.example` — **still open from the earlier audit**. `FINALITY_CONFIRMATIONS` is now aligned at `6`; that half is resolved. |
| `.env` | `MAX_MINER_FEE_SATS` and `MAX_FEE_RATE_SAT_VB` are present and **dead** — `load.ts` never reads them; the real caps are hardcoded at `config.ts:29-30`. Either wire them or delete them. |
| Undocumented | `COVE_MAINNET_SIGNED_TX`, `_FILE`, `_PSBT`, `COVE_MAINNET_CANARY_TICKER`, `COVE_MAINNET_FEE_RATE_SATVB`, `COVE_WIF`, `COVE_WIF_FILE`, `COVE_WIF_B`, `COVE_WIF_B_FILE` appear in **no** env file. Three of these control what gets broadcast. Document them. |

---

# Confirmed clean — do not "fix" these

Verified this round. Leave them alone.

- **No private key has ever been committed.** Every blob in every reachable commit was regex-scanned for WIF-shaped base58 and for `xprv`/`tprv`/`mnemonic`/PEM markers. One hit: the `sign.test.ts:8` fixture, confirmed to be the publicly-known `0x42`×32 burner. Correct practice — just never fund it.
- **No key leak path exists.** Every `console.log`, error message, manifest field, and network payload was traced. `toWIF()` has exactly two callers, both writing at mode `0600`. `.cove-mutinynet-proof.json` was read in full: addresses, txids, heights and state roots only.
- **Signing is deterministic RFC 6979.** No nonce reuse risk. Key generation uses the Node CSPRNG correctly.
- **`mainnet-custody.ts` holds, generates and derives zero key material.** Pure address-to-script decoding with mainnet params, round-trip verified, throws on wrong network. The "no-keys" claim on the mainnet path verifies clean: the canary exports an unsigned PSBT and exits; signed material only ever arrives from outside.
- **`regtest-reorg.ts:206-207` asserts `chain === "regtest"` before every mutating RPC call** — `createWallet`, `generateToAddress`, `importAddress`, `sendToAddress`, `invalidateBlock`. A genuine runtime gate, the strongest network control in the new code.
- **`-deprecatedrpc=create_bdb` appears only in the CI workflow**, never in TypeScript.
- **`broadcastSafely` (`signet-proof.ts:211-226`) is the correct pattern.** Use it as the model for B-6.
- **`readWithRetry` (`signet-proof.ts:51-62`) is correctly applied to reads only**, and says so.
- **Manifest amounts are hardcoded constants**, never read from the manifest — a tampered manifest cannot change an amount.
- **Env parsing fails closed.** `bool` returns false for anything outside an allowlist; `int` and `bigintOrNull` throw on garbage; `parseNetwork` is a strict allowlist that throws.
- **`cli.ts` has no mainnet path at all** and calls `requireSignet` in every network command.
- **`packages/cove-indexer/src/index.ts` exports only `CoveIndexer`, its types, and `COVE_SIGNET_CONFIG`** — the broadcast function is not importable from the package index.
- **State-root freezing is good work.** `state-root-reference.test.ts` cross-checks two independent implementations against golden vectors and asserts order-independence. Extend it to mainnet (A-2); do not rewrite it.
- **No `TODO`, `FIXME`, `@ts-ignore`, `eslint-disable`, `debugger` or skipped test anywhere** in `packages/` or `apps/`.

---

# Definition of done

```bash
pnpm typecheck   # green
pnpm lint        # green
pnpm test        # green, no --passWithNoTests masking an empty suite
pnpm build       # green
```

Plus the GitHub regtest workflow passing, and:

- [ ] Every S-item closed, each with a regression test that fails without the fix.
- [ ] S-1 specifically: the auditor's blind-signing proof-of-concept exists as a test and passes.
- [ ] Signet keys rotated.
- [ ] A-1: the canary refuses to run with mainnet flags at their defaults.
- [ ] A-2: H, treasuryScript and settlementScript are committed constants; env can only verify, and a mismatch exits non-zero.
- [ ] A-6: Bitcoin Core is mandatory for `--confirm-mainnet`; `testmempoolaccept` must pass; broadcast goes through the host that verified the chain.
- [ ] A-7: the signed tx and its txid are persisted **before** broadcast; the txid binding is unconditional; manifest mismatches throw.
- [ ] B-1: `recoveredRoot` is read from Postgres, the reorg genuinely reverts a transaction, and all seven post-conditions are asserted.
- [ ] B-8: a CI workflow runs typecheck, lint, test and build.
- [ ] **Mainnet remains unactivated.** No `COVE_*_MAINNET_ENABLED` set, no H set, no owner values populated, nothing broadcast to mainnet.

Report at the end: which items are done, which are not, and why.

---

# Discovered during this patch

_Append here. Do not silently expand scope._
