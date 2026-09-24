# Phase 7 — Complete Product / V3 API / Wallet UX / Real Regtest Application Gate

## Git

- Starting SHA: `1e91f84ed37cc9c6234dcda59ee046cd1a1d6306`
- Ending SHA: `3cc4b22` (plus the report commit)
- Branch: `main`, pushed to `origin/main`, working tree clean (only untracked `fr.html`).
- Logical commits: cove-app foundation → wallets/intent → web V3 rewrite → worker+E2E+CI → runtime/CI fixes.

## Frozen protocol — unchanged

wire V2, CoveStateV2, policy V3, tokenId, geometric20, V3 CMRs (MINT/REDEEM),
V3 MAST/NUMS, token-UTXO ownership, and Market Listing V1 were all left
untouched. The frozen-manifest test remains green in CI.

## Legacy isolation

Removed from the production path (architecture-gated by
`scripts/check-v3-architecture.mjs`, wired into `ci.yml`):

- `PrecopCRCAdapter`, `MockCRCAdapter`, `MockChainNode`, `MockBitcoinProvider`
- `quoteExactTokens`, legacy mint routes, `walletTokenBalances` / `listBalances`
- legacy `listings`/`trades` tables, `DEX_ASK/BID/CANCEL`, GRADUATED/SOLD_OUT
- legacy pages (`/portfolio`, `/liquidity`, `/mainnet/leaf`, `/for-crc`,
  `/token/[deploymentId]`, `/admin`) and legacy API routes (`/api/launch`,
  `/api/mint`, `/api/market`, `/api/tokens`, `/api/protocol`, …).

`route-inventory.test.ts` now asserts the V3 routes exist and the legacy routes
are absent.

## V3 runtime

- `@crclaunch/cove-app`: `V3AppService` composing Database + `CoreRpcProvider` +
  V3 indexer read models + Guardian V3 + cove-market + cove-economics.
- `apps/web/src/lib/v3-server.ts`: real Core RPC + Postgres + Guardian signer
  (`COVE_GUARDIAN_PRIVATE_KEY_HEX`, server-side only, regtest/staging only).
- `apps/worker/src/v3.ts`: continuous Core → persistent indexer → market
  reconcile → app tx-session reconcile, single-owner Postgres advisory lock.
- Mainnet hard-disabled everywhere (`MAINNET_DISABLED`).

## Wallet

- `WalletAdapter` interface with capabilities (psbt / bip322Simple / p2wpkh /
  p2tr / utxoDiscovery), canonical `paymentScript` identity.
- Browser-safe ECC-free client intent verifier (`verifyClientIntent`, digest
  match → `CLIENT_INTENT_MISMATCH`).
- Deterministic regtest E2E signers under `@crclaunch/wallets/e2e` (test harness
  only — never in a production client bundle).
- No mock wallet auto-connect in production.

## Product flows (all through the UI)

- **Launch**: precomputable tokenId (`H_CoveToken(chainIdentity||policyV3||ticker||nonce)`),
  review panel, DEPLOY final validator, validated broadcast, confirmed only when
  `cove_v3_tokens` records the token.
- **Backing buy**: quote state binding (`stateHash` + backing outpoint),
  Guardian Simplicity + reference policy, buyer wallet signature, final MINT
  validator, Core broadcast.
- **Transfer**: no Guardian, token coin selection, recipient script, final
  TRANSFER validator.
- **Redeem**: Guardian Simplicity, deterministic R-delta, wallet signature,
  final REDEEM validator.
- **P2P list / fill / cancel**: Phase-6 `MarketService` (prepare → BIP-322 sign →
  create; reserve → build → buyer sign → seller action-center sign → finalize →
  validated broadcast; signed cancellation).

## E2E (real Core + Postgres + Simplicity + worker + Next + Playwright)

Workflow: `.github/workflows/cove-v3-product.yml`. Boots Postgres, Bitcoin Core
28.1, Simplicity (CMR-pinned), `drizzle-kit push --force`, V3 worker, production
Next build, deterministic Playwright wallets (Alice/Bob/Carol). Scenarios:

1. launch FROG → token appears after indexer confirmation
2. buy 84M from backing → supply/backing = R(84M)
3. transfer 60M Alice→Bob → backing/supply unchanged
4. redeem 60M Bob → supply/backing decrease, capacity reopens
5. list 1M P2P (BIP-322) → ACTIVE
6. P2P fill (buyer sign → seller sign → finalize → broadcast) → listing FILLED,
   supply unchanged, backing unchanged
7. cancel a second listing → CANCELLED
8. mobile smoke (390px) on every page

## CI

- `Cove V3 product — real user lifecycle` run **36014941222**: success, 19/19
  passed, final `v3:verify` QUICK + FULL PASS.
- All Phase 4/5/6 workflows green on the same commit: CI, V3 indexer, V3 market,
  V3 full lifecycle, covenant, NUMS/vault, Simplicity, V1 reorg.

## Remaining blockers (Phase 8 only)

Production recovery quorum, Guardian/recovery key custody, durable
audit-before-sign, mainnet fee schedule, deployment topology, production Bitcoin
infrastructure, backups, monitoring, alerts, rate/value limits, emergency
disable/runbook, security review, canary caps, controlled mainnet enablement.

Mainnet remains **NOT READY**.
