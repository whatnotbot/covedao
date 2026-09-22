# Threat Model

## Assets

- User BTC (never custodied — but spent in user-signed transactions).
- User CRC-20 token balances (bearer assets on-chain).
- Graduation reserve BTC (protocol-controlled; never in a platform hot wallet).
- Platform fee revenue (platform treasury address only).
- Application reputation / integrity (no fake prices, volume, liquidity, states).

## Adversaries & mitigations

| Threat | Impact | Mitigation |
|---|---|---|
| Malicious creator (scam metadata, impersonation, links) | User harm, phishing | Plain-text only metadata, no HTML/SVG, explicit "Unverified token" label, report flow, admin hide-metadata, no auto "verified" badge |
| Malicious buyer (double-take, race final tokens) | Over-subscription corruption | Chain is authority; quotes never reserve supply; per-token mint-build lock; stale supply → rejected |
| Malicious seller (list more than owned, expired listing) | Bad fills | Chain checks balance at list time; expired listings rejected at take; full-fill only |
| Compromised frontend | PSBT substitution | User sees destination/amount before signing; server re-validates outputs; no hidden outputs |
| Compromised API | Build wrong tx, wrong fees | Output invariant validation (addresses/amounts/kinds), fee caps, treasury network check, audit logs |
| Bad RPC/provider | Wrong chain state | Primary+fallback provider, health state DEGRADED/UNSAFE disables writes, read-only continues |
| Reorg / double spend | Stale projections | Cursor hash comparison, walk-back to common ancestor, idempotent event upsert, `canonical` flag, reorg forensics, graduation → REORG_RECOVERY |
| Ticker race | Two creators same ticker | Multi-source check (DB + indexed state + fresh protocol query + post-confirm re-check); external deploy wins |
| PSBT substitution | Funds redirected | Re-decode + verify every output before signing and before broadcast; abort on any unexpected output |
| Fee manipulation | Overpay miners | `MAX_MINER_FEE_SATS` / `MAX_FEE_RATE_SAT_VB`; reject `TX_FEE_TOO_HIGH`; >20% requires confirmation, >50% blocked |
| Image/XSS payload | Client compromise | MIME sniffing, resize/re-encode to WebP, EXIF strip, reject SVG/HTML/JS, CSP, output encoding |
| Admin compromise | Misuse of admin controls | Admin cannot change balances/mint/steal reserve/modify supply/rewrite events; every admin action logged; kill switches are UI-level only |
| Protocol/indexer divergence | Wrong displayed state | State-hash mismatch raises alert, disables writes; reserve displayed as expected vs observed (mismatch disables graduation) |

## Explicit non-goals / hard rules

- No application-held user private keys (never stored, never logged).
- No custodial reserve hot wallet.
- No floating-point monetary math.
- No faking confirmation, liquidity, trades, holder counts, or market cap.
- No treating mempool as finalized.
- No global mutable blockchain state object (state is in Redis/DB).
