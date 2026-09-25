# Canary Day One — Runbook

This is the exact, ordered procedure to go from an **all-null public profile** to
a **confirmed, self-only mainnet canary**. It assumes Phase 8.1 is complete
(`docs/PHASE8.1_REPORT.md`) and the mainnet readiness gate CI is green. It never
asks you to put a private key in the repo, fund anything ahead of the canary, or
broadcast until the very last, human-approved step.

## 0. Read this first — the trade we are making

**Running the Guardian on a VPS instead of a dedicated HSM is a deliberate,
temporary trade.** It is acceptable **only while**:

- the canary allowlist is **you and only you** (your wallet script), and
- the caps are small (≤ 0.01 BTC backing, ~0.002 BTC per op).

It is **NOT acceptable** once any third party can deposit. Before that point,
move the Guardian signing key to a hardware signer / KMS / remote custody service
per `docs/GUARDIAN_CUSTODY.md`. A VPS-hosted key is a "warm" key — treat it as a
burner whose compromise is bounded by the allowlist + caps.

---

## 1. Generate the four keypairs (offline, air-gapped)

Run on a machine that will **not** host the app or the Guardian:

```bash
pnpm cove:ceremony-keys --out /Volumes/ceremony/keys
```

It writes `guardian.key`, `recovery-1.key`, `recovery-2.key`, `recovery-3.key`
(hex, mode 0600) to `--out`, and prints **only** the four x-only BIP340 pubkeys:

```
guardian      <64-hex>
recovery-1    <64-hex>
recovery-2    <64-hex>
recovery-3    <64-hex>
```

- Store each private key **separately**, offline, in different physical locations.
- The x-only pubkeys are **public** — that's what goes into the profile.
- Never put a `.key` file in the repo (they are gitignored; confirm with
  `git status --short` shows nothing new).

## 2. Fill the profile

Copy `config/cove-v3-mainnet-profile.template.json` to
`.cove-v3-mainnet-profile.json` (gitignored) and fill:

| Field | Value |
|---|---|
| `guardianXOnly` | the `guardian` x-only pubkey from step 1 |
| `recovery.threshold` | `2` |
| `recovery.pubkeys` | the 3 `recovery-*` x-only pubkeys (any order; they are sorted canonically) |
| `recovery.csvBlocks` | `2016` (≈2 weeks) |
| `activationHeight` | a **future** block height (see below) |
| `feeScript` | your fee-destination P2WPKH script (hex) |
| `buyFeeBps` / `redeemFeeBps` | `100` (1%) |
| `p2pFeeBps` | `50` (0.5%) |
| `canary.allowedWalletScripts` | **only your wallet script** |
| `canary.allowedTokenIds` | the single precomputed tokenId from launch prep |
| `canary.maxBackingSats` / `maxSingleBuySats` / `maxSingleRedeemPayoutSats` / `maxP2pSettlementSats` | the caps from §7 |

**`activationHeight`:** choose a block height that is still in the future so the
indexer begins indexing Cove ops exactly at `H`. (`getblockchaininfo` for the
current tip, then add margin.)

## 3. Static readiness

```bash
COVE_V3_MAINNET_PROFILE_PATH=.cove-v3-mainnet-profile.json pnpm cove:v3-mainnet-readiness --static
```

Expected: every `profile completeness` / `protocol profile match` / `recovery
profile` / `fee schedule` / `canary *` line `PASS`, and:

```
STATIC_PROFILE_READY
```

If it prints `READY_EXCEPT_FOR_OPERATOR_CEREMONY` with `OWNER_DECISION_REQUIRED`,
a field is still null — fix it before continuing.

## 4. Deploy the Guardian to a separate host

`apps/guardian` is a standalone Node HTTP service. On a host **separate** from
the web app/worker, with the profile + a Postgres DB + a primary (and optional
secondary) Core RPC:

```bash
COVE_V3_MAINNET_PROFILE_PATH=.cove-v3-mainnet-profile.json \
COVE_DATABASE_URL=postgres://… \
GUARDIAN_NETWORK=mainnet \
GUARDIAN_AUTH_TOKEN=<strong-random-token> \
GUARDIAN_PORT=4391 \
pnpm --filter @crclaunch/guardian start
```

(For production custody, the `UnconfiguredGuardianCustodyBackend` is replaced by
the selected backend — see `docs/GUARDIAN_CUSTODY.md`; there is no `exportPrivateKey`
and no generic sign endpoint.)

Health check (only public info):

```bash
curl -s http://guardian-host:4391/health -H "Authorization: Bearer <token>"
# {"reachable":true, "profileHash":"…", "guardianXOnly":"…", "custodyBackendReady":true, "signingEnabled":true, …}
```

Confirm `guardianXOnly` equals the profile value and `profileHash` equals the
output of step 3.

## 5. Runtime readiness

```bash
COVE_V3_MAINNET_PROFILE_PATH=.cove-v3-mainnet-profile.json \
COVE_BITCOIN_RPC_URL=http://primary-core \
COVE_BITCOIN_RPC_URL_SECONDARY=http://secondary-core \
COVE_GUARDIAN_ENDPOINT=http://guardian-host:4391 \
COVE_GUARDIAN_AUTH_TOKEN=<token> \
pnpm cove:v3-mainnet-readiness --runtime
```

Expected: primary/secondary Core, Core agreement, Guardian (reachable / profile
hash / key), custody backend, audit, signing journal all `PASS`, and:

```
READY_FOR_CONTROLLED_MAINNET_CANARY
```

## 6. Arm + first canary op (the only broadcast)

1. Arm the canary (`canaryActive = true`) — the stage moves to `CANARY_ACTIVE`
   and `mutationsEnabled` flips true.
2. Perform the **first** canary op — a single DEPLOY of the precomputed tokenId,
   then a single MINT to your own wallet — using the app's mutation path (which
   enforces the allowlist + caps and signs through the remote Guardian).
3. Watch the durable audit + signing journal and the backing invariant.

Do **not** proceed to public deposits — the allowlist is still you, and the
Guardian is still on a VPS.

## 7. Recommended starting caps (self-only, sanity-checked)

| Cap | Value | Sanity |
|---|---|---|
| `maxBackingSats` | `1000000` (0.01 BTC) | ✓ ≫ anchor (10 000); ≈5 × a 200 000-sats buy |
| `maxSingleBuySats` | `200000` | ✓ ≫ min gross for a non-dust fee (see below) |
| `maxSingleRedeemPayoutSats` | `200000` | ✓ payout ≫ dust (294) |
| `maxP2pSettlementSats` | `200000` | ✓ p2p fee at 50 bps = 1000 sats > dust |

**Fee-bps interaction to watch:** the protocol fee output must be non-dust
(P2WPKH dust = 294 sats). A gross of 200 000 sats produces fee = `200000 × bps / 10000`:

- at `buyFeeBps = 100` (1%) → fee = 2000 sats ✅
- at `buyFeeBps = 10` (0.1%) → fee = 200 sats ❌ below dust → `PROTOCOL_FEE_DUST`

So keep `buyFeeBps`/`redeemFeeBps` ≥ **20** (0.2%) with these caps, or raise the
caps. Recommended: `100` bps buy/redeem, `50` bps p2p (self-paid during a
self-only canary, and every fee output stays non-dust). Nothing else breaks: the
geometric20 curve accepts any amount above `MIN_CONTRIBUTION_SATS` (1000 sats),
and `maxBackingSats` is far above the 10 000-sats anchor.

## Rollback

Disarm the canary (`canaryActive = false`) or clear the profile hash — the stage
falls back to `CANARY_READY`/`READ_ONLY`, no new signs. If a backing invariant
fires, follow `docs/runbooks/RECOVERY_PROCEDURE.md` (never a compensating tx).

## Never

- Generate production keys with this agent, fund a mainnet wallet ahead of the
  canary, or broadcast until step 6's human-approved first op.
- Put a private key, WIF, or KMS credential in the repo or in `stdout`.
