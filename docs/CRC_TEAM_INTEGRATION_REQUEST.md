# CRC Team Integration Request

> A concise list for the CRC/PRECOP maintainers. CRC Launch is built; the items
> below are the exact canonical interfaces we need to make issuance canonical.

## Deployment

1. Can third-party applications request arbitrary CRC-20 deployment?
2. How is deployment authorized (Oracle signature, allowlist, other)?
3. What is the canonical deployment payload (exact JSON fields)?
4. What ticker rules exist (length, charset, uniqueness)?
5. Is ticker reservation / hold available before broadcast?
6. Can deployments reference a standardized issuance profile (e.g. `crc-launch-v1`)?

## Mint

7. What is the canonical mint payload (exact JSON fields)?
8. Who calculates the valid mint quantity — the application or the canonical validator?
9. Can canonical validation enforce a deterministic issuance curve?
10. Can canonical validation reject underpayment?
11. How does canonical state handle concurrent mints (last-token race)?
12. What constitutes replay protection (nonce, txid, state hash)?

## Oracle

13. Is there a public Oracle API?
14. Can external apps request Oracle signatures for deploy/mint?
15. What authentication / rate limits exist?
16. Is there a sandbox / testnet environment?
17. Is there an SDK (TS/JS preferred)?
18. Can applications subscribe to canonical state changes (webhooks/ws)?

## Indexer

19. Is canonical indexer state queryable over HTTP?
20. Is token balance query supported (by address)?
21. Is deployment status query supported?
22. Is an operation's rejection reason exposed?
23. Is historical state / a state API available (for reconciliation)?

## Marketplace

24. Are third-party markets currently supported?
25. Is canonical transfer / list / buy / cancel validation available?
26. Are asks/bids currently recognized by CRC Garden?

## Partnership

27. Would tokens deployed through CRC Launch be recognized by CRC Garden?
28. Would CRC maintainers consider adopting `crc-launch-v1` as a standardized
    issuance profile? (See `docs/CRC_LAUNCH_V1_PROPOSAL.md`.)
29. Could CRC Launch become an official/supported issuance interface?
30. Can we get a test/sandbox Oracle credential?

## Reference contract

The API shape we propose is in `docs/openapi/crc-canonical-api.yaml`, with a
working mock implementation in `apps/mock-crc-service` (no mainnet behavior is
invented — it is a shape, not a claim about current CRC).
