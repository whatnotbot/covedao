# @crclaunch/cove-indexer — LEGACY / REFERENCE

> ⚠️ **LEGACY / REFERENCE ONLY.** This package implements the OP_RETURN-based
> Cove **V1** protocol (`DEPLOY` / `MINT` / `TRANSFER` envelopes) with
> **indexer-authoritative balances**, the mainnet canary, and the virtual
> liquidity simulator.
>
> It is **not** the production token protocol. The production path is the
> Taproot-native soft covenant in `packages/cove-covenant` +
> `packages/cove-guardian` (see `docs/COVE_COVENANT_ARCHITECTURE.md`).
>
> **Do not reactivate the OP_RETURN / indexer-authoritative balances as the
> authority.** Reusable infrastructure (Bitcoin RPC, PSBT builder, P2TR
> utilities, tx decoding, fee validation, wallet signing, regtest harness) is
> preserved and consumed by the covenant packages, but the balance authority
> model below is frozen.

## What remains here (frozen)

- `indexer.ts` — OP_RETURN `DEPLOY`/`MINT`/`TRANSFER` indexer + balances
- `signet-proof.ts` / `mutinynet-proof.ts` — V1 network proofs
- `mainnet-canary.ts` / `mainnet-custody.ts` — V1 mainnet canary (gated)
- `liquidity-demo.ts` — virtual constant-product liquidity simulator (mock)
- `regtest-reorg.ts` — V1 regtest reorg recovery proof

## What moved to the covenant packages

- State encoding / state hash / state-committed P2TR → `@crclaunch/cove-covenant`
- Transition policy + validate-then-sign Guardian → `@crclaunch/cove-guardian`
- Deterministic regtest proof → `pnpm cove:regtest-proof`
