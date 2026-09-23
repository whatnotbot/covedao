# Cove NUMS / Dual-Leaf Vault (Phase 2)

> Implements the PRECOP **documented** vault target (yellowpaper §4.3 refund leaf +
> the sovereign-routing execution pattern) under current Bitcoin mainnet rules,
> with one deliberate hardening the reference implementation lacks: a **NUMS
> internal key** so there is **no key-path spend**.

## 1. Construction

```
                    P2TR output key Q
                         │
              NUMS internal key (no private key)
                         │
                 Taproot MAST (dual leaf)
                  /                      \
       EXECUTION LEAF                RECOVERY LEAF
       <S1_hash> OP_EQUALVERIFY     <144> OP_CHECKSEQUENCEVERIFY
       <guardian> OP_CHECKSIG       OP_2DROP <owner> OP_CHECKSIG
```

```
Q = NUMS + H_TapTweak(NUMS || merkleRoot)·G
merkleRoot = TapBranch(executionTapleaf, recoveryTapleaf)   (sorted)
```

There is **no** Guardian key-path spend, **no** owner key-path spend, and **no**
fallback key-path private key: `Q` is derived solely from the NUMS internal key
and the committed Taproot tree. Every spend is a script-path reveal.

## 2. NUMS internal key

`50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0` — the
BIP341 nothing-up-my-sleeve point (`lift_x(SHA256(generator))`), with no known
discrete log. (PRECOP papers do **not** publish a NUMS key; the reference
implementation uses a BIP-86 HD key and signs key-path. This NUMS key is Cove's
own documented constant.)

## 3. Golden vectors (regtest, successor S1 hash `27fb483a…82828a`)

| Item | Value |
| --- | --- |
| Guardian x-only (`priv=0x42`) | `24653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d2353dc0ab1c` |
| Owner x-only (`priv=0x43`) | `7f31ebc5462c1fdce1b737ecff52d37d75dea43ce11c74d25aa297165faa2007` |
| Execution tapscript | `2027fb483a…288a 88 2024653eac…ab1c ac` |
| Recovery tapscript | `02 9000 b2 6d 20 7f31ebc5…2007 ac` |
| Execution tapleaf | `b25c34ff056e4c1ed4783a8c0d866c7f0458896e0241fa44d6d84168739fc71c` |
| Recovery tapleaf | `5884d4ba7ae76c9706dd44bb8edfca86180c968af469d3da28b9ccc0fff45998` |
| Merkle root | `3bdcd984978c70124507f9fd79e98b7fa46f585af6445d055d313b20be933a36` |
| Output key Q | `be5f27a70ac215cdb98da7af6a35a46645c8ab58cfb7d657f7738068ec1ac9ff` |
| scriptPubKey | `5120be5f27a70ac215cdb98da7af6a35a46645c8ab58cfb7d657f7738068ec1ac9ff` |
| address (regtest) | `bcrt1phe0j0fc2cg2umwvd57hk5ddyvezu326ce7mav4lhwwqx3mq6e8lsjemasd` |

## 4. CSV semantics

- Recovery leaf: `<144> OP_CHECKSEQUENCEVERIFY OP_2DROP <owner> OP_CHECKSIG`.
- Witness: `[owner_sig(64), pad(0), script, control_block]` (OP_CSV leaves the
  `<144>` operand on the stack, so OP_2DROP drops it plus one padding item).
- Relative delay: `nSequence = 144`; the spend is valid only 144 blocks after the
  vault confirms. `nSequence = 143` (delay−1) fails OP_CSV.

## 5. Execution leaf (Part F)

`<successorStateHash> OP_EQUALVERIFY <guardian_xonly> OP_CHECKSIG` — mirrors
PRECOP's sovereign-routing commitment-reveal + authorizing signature. The
Guardian pre-executes the **full Phase 1.5 transaction policy** off-chain
(curve contribution, reserve delta, recipient, platform fee, change, miner fee,
order, prevout, network, phase) and only then produces the script-path CHECKSIG.
Bitcoin enforces the CHECKSIG + hash reveal; the curve/amount policy is
Guardian-enforced (Simplicity is **not** consensus on mainnet).

## 6. Real CSV proof (verified)

`pnpm cove:csv-proof` (CI: `.github/workflows/cove-vault-csv.yml`):

- premature (nSequence=144, immature) → `testmempoolaccept` **REJECT** (`non-BIP68-final`)
- boundary delay−1 (nSequence=143) → **REJECT** (`Locktime requirement not satisfied`)
- boundary delay (nSequence=144) → **ACCEPT**
- recovery spend mined; witness decoded = `[64B sig, pad, tapscript, control block]`,
  matching the committed recovery tapscript + control block exactly.

## 7. Simplicity status (honest)

The full curve/amount policy is **off-chain** (Guardian). The PRECOP reference's
"Simplicity" is a Rust loop over string-label tapleaves (see
`CRC_GARDEN_FORENSICS.md` §6) — **NOT** a real Simplicity Bit Machine. Cove does
not claim to run Simplicity on-chain.
