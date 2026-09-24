# Mainnet Go-Live Checklist

Every item required before enabling any mainnet write flag.

## Protocol verification

- [ ] CRC arbitrary deploy semantics verified
- [ ] Ticker collision rules verified
- [ ] CRC mint semantics verified
- [ ] Progressive pricing enforcement mechanism verified
- [ ] Required BTC outputs verified
- [ ] Platform fee output verified
- [ ] Reserve/vault semantics verified
- [ ] Transfer semantics verified
- [ ] Marketplace ask semantics verified
- [ ] Marketplace bid/take semantics verified
- [ ] Cancellation semantics verified
- [ ] Protocol treasury fee verified

## Infrastructure

- [ ] Node synced
- [ ] State hash healthy
- [ ] Treasury address checked (mainnet address on mainnet; testnet = fatal)
- [ ] Backup Bitcoin provider tested
- [ ] Production DB backup enabled
- [ ] Monitoring enabled
- [ ] Rate limits enabled

## Tests & security

- [ ] Reorg tests passing
- [ ] PSBT invariant tests passing
- [ ] Dependency audit clean
- [ ] No critical/high security findings
- [ ] Admin kill switches tested

## Compliance & product

- [ ] Terms/risk disclosure deployed
- [ ] Feature flags set explicitly (default `false`)

## Enabling writes

Only after all the above are complete, set — for each operation individually:

```env
CRC_PROTOCOL_VERIFIED=true
CRC_DEPLOY_MAINNET_ENABLED=...   # only if DEPLOY is VERIFIED
CRC_MINT_MAINNET_ENABLED=...     # only if MINT is VERIFIED
CRC_MARKET_MAINNET_ENABLED=...   # only if DEX ASK/BID are VERIFIED
CRC_GRADUATION_MAINNET_ENABLED=...  # only if GRADUATION/reserve are VERIFIED
```

`CRC_PROTOCOL_VERIFIED=true` alone does **not** enable writes; each specific
flag must also be true.
