# Mainnet ceremony

Everything testable has been tested. What is left is a set of decisions and
secrets that only the operator may make and hold. This document is the
checklist; it deliberately contains no keys and no values.

Check progress at any point with:

```
pnpm cove:v3-mainnet-readiness
```

It never broadcasts anything. It names every field still missing and prints a
stage verdict. Today that verdict is `READY_EXCEPT_FOR_OPERATOR_CEREMONY`.

---

## 1. Generate the keys — offline

```
pnpm --filter @crclaunch/cove-vault ceremony-keys --out /Volumes/<removable>/keys
```

This writes four private keys, one file each, mode 0600, to the path you give
it. It prints only the public halves. It refuses to overwrite an existing file.

Run it on a machine that is not on a network, and write to removable media.
Whoever holds `guardian.key` can sign every vault transition on mainnet.

Output:

| File | What it is |
|---|---|
| `guardian.key` / `.pub` | Signs every buy and redeem. The hot key. |
| `recovery-1.key` / `.pub` | One of three emergency keys. |
| `recovery-2.key` / `.pub` | " |
| `recovery-3.key` / `.pub` | " |

**The three recovery keys must be stored in three separate places.** Two of the
three can move BTC out of a vault after the CSV delay. If all three sit in one
drawer, the 2-of-3 threshold protects nothing. Separate custodians are better
than separate folders.

**The guardian key must never be one of the three recovery keys.** The profile
validator rejects that outright (`GUARDIAN_KEY_IN_RECOVERY_SET`), because a
single compromise would otherwise take both the hot path and the escape hatch.

---

## 2. Fill in the profile

Copy the template and edit it:

```
# edit packages/cove-mainnet/src/committed-profile.ts (public values only) and commit it
```

The real file is gitignored. The template carries every frozen protocol
constant already filled in and verified — `protocol profile match` passes as
shipped, so any later failure there means something was edited that should not
have been.

### Decisions

| Field | What it means |
|---|---|
| `activationHeight` | Block height at which Cove becomes live. Pick one comfortably in the future; operations below it are ignored. |
| `guardianXOnly` | Contents of `guardian.pub`. |
| `recovery.pubkeys` | The three `recovery-N.pub` values. |
| `recovery.csvBlocks` | Delay before recovery may spend. 144 ≈ 24 hours. Valid range 1–65535. |
| `feeScript` | Leave `null`. Fees go to `COVE_FEE_ADDRESS` (a `bc1…` address you control), set identically on web, worker and Guardian. |
| `buyFeeBps` | Fee on a curve buy, in basis points. 100 = 1%. |
| `redeemFeeBps` | Fee on a redeem, in basis points. |
| `p2pFeeBps` | Fee on a peer-to-peer fill, in basis points. |

### Canary limits

The canary is a training-wheels phase. Only the listed wallets and tokens may
transact, and no amount may exceed the ceilings.

| Field | What it means |
|---|---|
| `canary.allowedWalletScripts` | Wallets permitted to transact. At least one. |
| `canary.allowedTokenIds` | Tokens permitted to transact. At least one. |
| `canary.maxBackingSats` | Ceiling on total BTC held across the protocol. |
| `canary.maxSingleBuySats` | Ceiling on one buy. |
| `canary.maxSingleRedeemPayoutSats` | Ceiling on one redeem payout. |
| `canary.maxP2pSettlementSats` | Ceiling on one P2P settlement. |

Start small. Limits can be widened later; losses cannot be undone.

---

## 3. Infrastructure the readiness check also wants

These are separate from the ceremony and currently report FAIL:

- **Secondary Bitcoin Core.** A second node arms a two-node quorum that fails
  mutations closed when the two disagree. One node is a single point of both
  failure and lies.
- **Remote Guardian service.** On mainnet the app refuses to hold the guardian
  private key in process. It calls out to `apps/guardian`, authenticated, and
  verifies the committed profile hash. `COVE_GUARDIAN_ENDPOINT` and
  `COVE_GUARDIAN_AUTH_TOKEN` point at it.
- **Custody backend, audit sink, signing journal.** Durable storage for the
  signing journal and the audit trail, so a restart cannot re-sign a
  transition that was already issued.

---

## 4. What is already proven

Do not re-litigate these; they have been executed, not asserted.

| Proof | Where |
|---|---|
| Full product journey through the real UI — launch, buy, transfer, redeem, list, atomic fill, cancel | `pnpm --filter @crclaunch/web test:e2e` (13/13) |
| Wire v2 / crc-20 relayed and mined by a public Bitcoin network | Mutinynet blocks 3454447–3454449 |
| 2-of-3 recovery: 1-of-3 refused, early refused, malformed refused, 2-of-3 accepted at maturity | `pnpm --filter @crclaunch/cove-recovery recovery-regtest` |
| CSV timelock exact to the block: premature refused, delay−1 refused, delay accepted | `pnpm cove:csv-proof` |
| Reorg survival: chain rewound, state rebuilt identically | `pnpm cove:v3-regtest-lifecycle` |

---

## 5. The one thing this repository will not do for you

It will not generate, hold, or transmit a key that controls real money on your
behalf, and you should not accept one from any tool that offers to. Run the
ceremony yourself, offline, and keep the private halves off this machine.
