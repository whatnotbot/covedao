# Cove Covenant — Taproot-Native Soft Covenant Architecture (Phase 1)

> **Status:** Phase 1 deliverable — state-committed Taproot UTXOs, deterministic
> Cove state vectors, a hardened Guardian signer that enforces a transition
> policy *off-chain*, and a deterministic regtest proof of a valid S0 → S1
> spend plus three adversarial refusals.
>
> **Terminology (honest, not aspirational).** This is a **Taproot-native soft
> covenant**. Each successor UTXO is a **state-committed UTXO** whose Taproot
> output key commits to a Cove state. The transition rule is a
> **Guardian-enforced Simplicity policy**: the Guardian validates the transition
> and signs *only* after it passes; the policy is *not* evaluated by Bitcoin
> consensus. Settlement is **Bitcoin L1**: the spend is an ordinary,
> Bitcoin-mainnet-valid transaction whose Taproot key-path signature a node
> validates.
>
> We do **not** claim that Bitcoin consensus executes Simplicity, that this is a
> hard covenant, or that the Cove contract is consensus-enforced. Those are not
> true today and are not claimed here.

---

## 1. What this document covers

This is the architecture for the **covenant reset**, replacing the OP_RETURN /
indexer-authoritative Cove V1 (now legacy/reference — see §11). It is
deliberately scoped to the first deliverable:

1. State encoding (`cove-covenant/src/state.ts`)
2. State hash (domain-separated SHA-256)
3. State-dependent P2TR construction (`cove-covenant/src/taproot.ts`)
4. The S0 → S1 transition (`cove-covenant/src/transition.ts`)
5. Guardian validation + signing (`cove-guardian/src/policy.ts`, `signer.ts`)
6. Golden vectors (hardcoded, deterministic)
7. Regtest proof (`cove-guardian/src/regtest-proof.ts`)

It is **not** the whole product. Liquidity, graduation, redeem, and multi-party
signing are future phases (§10).

---

## 2. Reference architecture

The design follows the public shape of PRECOP / TUSM / Astrolabe
state-commitment covenants, as re-implemented from first principles (not copied):

| Concept | PRECOP-style pattern | Cove Phase 1 |
| --- | --- | --- |
| State → canonical encoding | fixed-width, endian-explicit serialization | 51-byte `CoveState` (§3) |
| Encoding → commitment | SHA-256 with domain separation | `stateHash` = `sha256("Cove/State/v1" \|\| 0x00 \|\| bytes)` (§4) |
| Commitment → Taproot key | fold commitment into the BIP341 tweak | `Q = P + H_TapTweak(P \|\| stateCommitment)·G` (§5) |
| Commitment → address | bech32m P2TR address over `Q` | `0x51 0x20 \|\| Q` (§5) |
| Proposed transaction | PSBT | `bitcoin.Psbt` key-path spend (§7) |
| Guardian context | independently reconstructs state + transition | `validateMint` re-derives S1 via `applyMint` (§6) |
| Policy pre-execution | Simplicity verifies transition before signature | off-chain TypeScript re-implementation today; Simplicity commitment later (§8) |
| Guardian signs | only after success | `authorizeMint` validates, then Schnorr-signs (§7) |
| Successor UTXO | commits the next state | output `0x51 0x20 \|\| Q(S1)` (§7) |

---

## 3. State encoding

`CoveState` is a deterministic, fixed-width, big-endian vector:

| Field | Width | Type | Notes |
| --- | --- | --- | --- |
| `version` | 1 B | u8 | `0x01` |
| `tokenId` | 32 B | bytes | token identity (hex) |
| `phase` | 1 B | u8 | `PUBLIC_MINT=0`, `GRADUATED=1`, `LIQUIDITY=2` |
| `publicSupplyAtoms` | 8 B | u64 BE | supply in atoms (sats of token) |
| `reserveSats` | 8 B | u64 BE | BTC reserve in sats |
| `curveStage` | 1 B | u8 | bonding-curve stage index |

Total: **51 bytes** (`COVE_STATE_BYTES`). Serialization uses a `DataView` with
`setBigUint64` (explicit BE) so the byte image is unambiguous and reproducible
across runtimes — the same property PRECOP relies on for its canonical encoding.

---

## 4. State hash

```
stateHash(state) = SHA-256( "Cove/State/v1" || 0x00 || serializeState(state) )
```

- `STATE_DOMAIN = "Cove/State/v1"` is the domain-separation prefix (prevents
  cross-domain ambiguity).
- The `0x00` separator disambiguates the domain string from the payload.
- Golden S0 hash: `e27d7047a2a2f05a3f7ac319e12207c11487b59dcb212402785c129b85c518e2`.

---

## 5. State-dependent Taproot construction

The state is committed by folding a domain-separated state commitment into the
**BIP341 tweak**, exactly where a Taproot script-tree merkle root would go:

```
stateCommitment(state) = tagged_hash("CoveState", stateHash(state))
tweak                  = H_TapTweak( P || stateCommitment(state) )
outputKey Q            = P + tweak · G          (BIP341 key tweak)
scriptPubKey           = 0x51 0x20 || xonly(Q)  (P2TR, 34 bytes)
address                = bech32m(xonly(Q))      (network-dependent)
```

Properties:

- **Deterministic**: the same `(P, state)` always yields the same `Q`, script,
  and address.
- **State-distinguishing**: `S0 ≠ S1 ⇒ Q(S0) ≠ Q(S1)` (verified by test and in
  the proof). Two states can never collide onto one address (barring an
  astronomically improbable hash collision).
- **Publicly verifiable**: anyone who knows `P` and a state can confirm the
  address commits to that state; anyone who only sees the address cannot invert
  the state (it is a hash commitment).
- **Collision-safe vs. script trees**: `stateCommitment` uses the custom tag
  `CoveState` (a BIP340-style tagged hash), so it can never be confused with a
  genuine Taproot script-tree merkle root (`TapLeaf`/`TapBranch` tags).

> Honest note on terminology: the commitment occupies the "merkle-root" position
> of the BIP341 tweak. In Phase 1 the script path is **empty** — there is no
> spendable script tree. The state commitment is carried by the *key* tweak, not
> by an on-chain script. The wire output is a normal P2TR output indistinguishable
> from any other Taproot output.

Golden vectors (internal key `P = 24653eac…c0ab1c` from deterministic private
key `32 × 0x42`):

| State | stateHash | commitment | outputKey Q | address (regtest) |
| --- | --- | --- | --- | --- |
| S0 | `e27d7047…c518e2` | `8f3073a6…f46a37` | `e6f6455a…68c5c7` | `bcrt1pummy2…nxf5` |
| S1 | `27fb483a…82828a` | — | `d15aa47b…c087a0` | `bcrt1p69d2g…d6uej6` |

---

## 6. Transition model

`applyMint(prev, amountAtoms)` is the reference transition. It:

1. rejects `ZERO_MINT` and `SUBTOKEN_MINT`;
2. prices the mint on the bonding curve (`quoteExactTokens`, `getStageForSupply`);
3. enforces supply conservation and `OVERMINT` protection;
4. returns `{ nextState, curveContributionSats }` — a **deterministic successor**.

For the proof vector, a 42,000,000-token mint from S0 yields:

```
S1.publicSupplyAtoms = 4_200_000_000_000_000 (0x000eebe0b40e8000)
S1.reserveSats       = 21_000               (0x0000000000005208)
S1.curveStage        = 2
curveContributionSats= 21_000
```

The Guardian does **not** trust the proposer's successor: `validateMint`
**re-derives** the successor with `applyMint` and compares it byte-for-byte
against the proposed `nextState`. A manipulated successor is rejected
(`SUCCESSOR_STATE_MISMATCH` / `RESERVE_MOVEMENT`).

---

## 7. Guardian trust model

**The Guardian is a trusted third-party signer**, not a trustless contract. This
is stated plainly because it is the honest security posture of Phase 1.

- The Guardian holds the private key `d` for the **internal key** `P`. For a
  key-path spend of a state-committed UTXO it must sign with the **output key**
  `Q = P + t·G`, so it derives the tweaked private key `d + t (mod n)` using
  `t = H_TapTweak(P || stateCommitment(state))` (see `stateTweak`, §5).
- **Sign only after validation**: `authorizeMint(ctx)` runs `validateMint(ctx)`
  first; on failure it throws and produces **no signature**. The transition
  digest signs everything that matters:

  ```
  transitionDigest = SHA-256(
      "Cove/GuardianAuth/v1" || 0x00 ||
      stateHash(prev)  || stateHash(next) ||
      u64(amountAtoms) || u64(curveContributionSats) || u64(feeSats) ||
      recipientCommitment || networkByte )
  ```

- **Independent context reconstruction**: the digest commits to the full context
  (prev state, next state, payment, fee, recipient, network), so a Guardian
  cannot sign one transition while another party later claims a different one.
- **Fee and recipient discipline**: `MAX_FEE_SATS = 50_000`, and the recipient
  must be a well-formed P2TR (`5120‖32B`) or P2WPKH (`0014‖20B`) commitment.

Threat posture (Phase 1): a single hardened Guardian is a single point of
failure and a single point of trust. If the Guardian key is compromised, the
attacker can sign *any* transition. Bitcoin would still accept those spends —
the covenant does not constrain them on-chain. That is the exact motivation for
Phase 2 (multi-party signing) and Phase 3 (on-chain policy commitment) in §10.

---

## 8. Simplicity execution method

Phase 1 is honest about where the policy runs:

- **Design target.** The transition predicate (`applyMint` + `validateMint`) is
  written as an ordinary, auditable TypeScript function. It is the *reference
  semantics* of the future Simplicity program.
- **Pre-execution by the Guardian.** "Guardian-enforced Simplicity policy" means
  the Guardian executes the predicate **before** signing, and refuses to sign on
  failure. The predicate is never placed in a Bitcoin script today.
- **Bitcoin does not execute Simplicity.** Mainnet has no Simplicity opcode. The
  only thing a node validates is the Taproot key-path Schnorr signature over the
  output key (§5, §7) and normal consensus rules (amounts, no double-spend,
  etc.).

Future (Phase 3): the same predicate will be compiled to Simplicity; its
commitment (the Simplicity SWHASH / single-use commitment) will be committed via
a **tapleaf** (script path) or folded into the key tweak alongside the state
commitment, so that the *Bitcoin-verifiable* spending condition matches the
Guardian's off-chain policy. Until a soft fork or a sidechain/CHAIR environment
provides Simplicity semantics on Bitcoin, the covenant remains Guardian-enforced.

---

## 9. What Bitcoin enforces vs. what the Guardian enforces

| Property | Enforced by | How |
| --- | --- | --- |
| Valid Taproot key-path spend | **Bitcoin consensus** | Schnorr signature over `Q(S0)` (BIP340/BIP341) |
| No inflation / no double-spend | **Bitcoin consensus** | UTXO set rules |
| Successor output exists with correct amount | **Bitcoin consensus** | transaction outputs |
| State is committed in the successor | **Guardian** (then Bitcoin preserves it) | Guardian only signs if output script = `Q(S1)` |
| Transition is curve-correct (no overmint) | **Guardian** | `applyMint` + `validateMint` |
| Payment (curve contribution) is correct | **Guardian** | `PAYMENT_MISMATCH` |
| Reserve movement is correct | **Guardian** | `RESERVE_MOVEMENT` |
| Recipient is well-formed | **Guardian** | `RECIPIENT_MALFORMED` |
| Fee is bounded | **Guardian** | `FEE_OUT_OF_RANGE` |
| Simplicity policy semantics | **Guardian** (off-chain) | pre-execution before signing |

The invariant to state plainly: **Bitcoin enforces that a validly-signed
state-committed UTXO can move to a state-committed successor; the Guardian
enforces *which* successor is legitimate.** A compromised or malicious Guardian
can produce a valid Bitcoin spend to an arbitrary successor — Bitcoin will not
stop it. The covenant's correctness is therefore a *policy-layer* property in
Phase 1, not a consensus property.

---

## 10. Adversarial rejection coverage (proof)

`regtest-proof.ts` demonstrates, deterministically and offline:

1. S0/S1 hashes and distinct P2TR outputs;
2. Guardian `validateMint` PASS for the honest mint;
3. Schnorr authorization verifies against the Guardian key;
4. three manipulations each rejected **and** unsigned:
   - manipulated successor state → `RESERVE_MOVEMENT`, signerRefused = YES;
   - manipulated payment → `PAYMENT_MISMATCH`, signerRefused = YES;
   - manipulated recipient → `RECIPIENT_MALFORMED`, signerRefused = YES;
5. a real `bitcoin.Psbt` key-path spend of the S0 UTXO to the S1 UTXO, finalized
   and extracted, whose successor output commits to S1 and whose key-path
   Schnorr signature is **independently re-verified** against `Q(S0)` (the same
   check a Bitcoin node performs).

Run: `pnpm cove:regtest-proof`.

---

## 11. Legacy / reference (deprecated)

The OP_RETURN Cove V1 is **legacy/reference**, not the production token
protocol:

- `DEPLOY`/`MINT`/`TRANSFER` OP_RETURN envelopes;
- indexer-authoritative balances;
- mainnet canary;
- virtual liquidity simulator.

Reusable infrastructure is preserved and reused by this reset: Bitcoin RPC,
PSBT builder, P2TR utilities, tx decoding, fee validation, wallet signing,
regtest harness, web UI, curve math, liquidity math.

The OP_RETURN/indexer-authoritative path must **not** be reactivated as the
balance authority.

---

## 12. Remaining path to mainnet

| Phase | Work | Honest status |
| --- | --- | --- |
| 1 (this) | state encoding, state-committed P2TR, S0→S1, Guardian validate+sign, golden vectors, regtest proof | ✅ delivered |
| 2 | replace single Guardian with **2-of-2 / n-of-m MuSig2** (user co-sign + Guardian); key custody / HSM | planned — removes single-point-of-failure, still Guardian-enforced |
| 3 | commit the **Simplicity** policy on-chain via script-path tapleaf (or fold SWHASH into tweak); evaluate tradeoffs: script-path vs key-path, MuSig2 vs 2-of-2, upgrade path for policy changes | planned — requires Simplicity-capable execution environment (soft fork / sidechain / CHAIR) |
| 4 | liquidity, graduation, redeem transitions on the same state-committed UTXO model | planned |
| 5 | regtest → signet → mainnet staged rollout with canary + monitoring | gated; **mainnet remains unactivated** |

**Tradeoff note for Phase 3 (recorded now):** a key-path spend (Phase 1) is
cheapest and private, but the policy lives entirely with the signer. A
script-path tapleaf that reveals the Simplicity commitment makes the policy
*Bitcoin-verifiable* (once Simplicity semantics exist) at the cost of revealing
the script and paying the script-path weight. A 2-of-2 user+Guardian (MuSig2)
key-path keeps privacy and removes unilateral Guardian power but still does not
put the policy on-chain. These are not mutually exclusive; the intended end
state combines a user+Guardian MuSig2 with an optional script-path policy
commitment.

---

## 13. Files

| Path | Role |
| --- | --- |
| `packages/cove-covenant/src/types.ts` | `CoveState`, `CovePhase`, `CoveOperation`, `CoveTransition` |
| `packages/cove-covenant/src/state.ts` | 51-byte serialization + `stateHash` |
| `packages/cove-covenant/src/taproot.ts` | `stateCommitment`, `stateTweak`, `deriveStateOutput`, `stateOutputScript` |
| `packages/cove-covenant/src/transition.ts` | `applyMint`, `isCorrectMintSuccessor`, `CovenantError` |
| `packages/cove-covenant/src/*.test.ts` | 21 tests incl. golden vectors |
| `packages/cove-guardian/src/policy.ts` | `validateMint` (13 reason codes) |
| `packages/cove-guardian/src/signer.ts` | `TaprootGuardianSigner` (validate-then-sign) |
| `packages/cove-guardian/src/regtest-proof.ts` | deterministic regtest proof (steps 1–6) |
