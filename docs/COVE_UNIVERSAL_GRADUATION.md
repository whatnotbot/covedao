# Cove FROG → Universal (BRC-20 Extended) Graduation — Source-Backed Specification

**Scope:** How a token "Cove FROG" (supply **1,000,000,000**, public portion **840,000,000**) can graduate from a CRC bonding curve into the **Universal** BRC-20 extension and then trade on the **WhiteNode** marketplace **without duplicating circulating supply**.

**Method:** forensic source review of the `The-Universal-BRC-20-Extension` GitHub organization (cloned into `/tmp`, never committed), live API/exporer decoding of the PAPER token, and web search for "Pumpologia" / "WhiteNode".

**Classification key (used on every factual claim):**
- `ON_CHAIN_VERIFIED` — decoded directly from a Bitcoin transaction / live explorer / live API response reflecting chain state.
- `SOURCE_VERIFIED` — read directly from repository source at a pinned commit.
- `DOCUMENTATION_CLAIM_ONLY` — stated in protocol docs / website / spec but not confirmed in implementation or on chain.
- `INFERENCE` — reasoned conclusion from the above; not directly observed.

> Bottom line up front: the on-chain PAPER token and the protocol source support **pre-deployed Universal supply** (single full-supply `mint` to a treasury/issuer, then `transfer`-based distribution) as the graduation mechanism. The "Pumpologia" *name* could not be verified from any public source; its alleged SEAL→CLAIM flow, decoded for PAPER, is simply **deploy → full-supply mint → transfer distribution**, with no burn, no curve, and no bridge.

---

## 1. Pinned revisions

All SHAs are `git rev-parse HEAD` of `main` (the default branch of every repo below), cloned into `/tmp/universal-research` on the research date. None of the clones were committed anywhere.

| Repository | Default branch | Pinned HEAD SHA |
|---|---|---|
| `The-Universal-BRC-20-Extension/Simplicity` (the indexer / reference implementation) | `main` | `ba566350f084e4d75c05858de4c0d1e5b52f729f` |
| `The-Universal-BRC-20-Extension/Protocol` (canonical protocol spec) | `main` | `0a712baabaffdc8e47b6dae14f877451d2142105` |
| `The-Universal-BRC-20-Extension/OPI` (OPI proposals) | `main` | `bb5874a66ddc53e993135a07e33fb2c3cfccea09` |
| `The-Universal-BRC-20-Extension/opool.space` (app, mempool.space fork; WhiteNode client) | `main` | `2f4c17dbac1ac75e115054385f84a6efa8afab25` |
| `The-Universal-BRC-20-Extension/opool_index` (OP_RETURN indexer for opool.space) | `main` | `b4aa544cd50c06220b196b1e125dda0966c1dfb1` |
| `The-Universal-BRC-20-Extension/agora` (forum; BRC-20 placeholder) | `main` | `eadc473168a4c92019828f4f0bec419d47adac7e` |

URLs (all `SOURCE_VERIFIED` via `gh` / `git`):

- Simplicity: https://github.com/The-Universal-BRC-20-Extension/Simplicity
- Protocol: https://github.com/The-Universal-BRC-20-Extension/Protocol
- OPI: https://github.com/The-Universal-BRC-20-Extension/OPI
- opool.space: https://github.com/The-Universal-BRC-20-Extension/opool.space
- opool_index: https://github.com/The-Universal-BRC-20-Extension/opool_index
- agora: https://github.com/The-Universal-BRC-20-Extension/agora

Other repos in the org (listed via `gh repo list`, `SOURCE_VERIFIED`): `universal-logo`, `brc20kit`, `OPI-LC`. None of them mention "WhiteNode", "Pumpologia", "SEAL", or "CLAIM".

### WhiteNode

- **WhiteNode is NOT a GitHub repository in this ecosystem.** `SOURCE_VERIFIED` (GitHub code/repo search for `WhiteNode` returns only unrelated "Whitecoin" IoT projects).
- WhiteNode is the live marketplace/frontend of Universal BRC-20: **https://www.whitenode.co** (title: "Universal — The BRC-20 Extended"), X `https://x.com/Universal_fdn`, Telegram `https://t.me/universalbrc20`, docs `https://www.whitenode.co/docs`, API host `https://api.whitenode.co`. `ON_CHAIN_VERIFIED` (fetched the live site) + `DOCUMENTATION_CLAIM_ONLY` (the self-description).
- The Protocol README names Whitenode as a key infrastructure partner: "Whitenode Technical Documentation: https://www.whitenode.co/docs". `SOURCE_VERIFIED` (`Protocol/README.md` line 297).

### Pumpologia

- **"Pumpologia" was NOT found as a GitHub repository, org, or code** (`gh search repos` and `gh search code` return nothing). `SOURCE_VERIFIED` (negative result).
- Only a low-trust domain `pumpologia.com` exists (recently registered, `noindex,nofollow`, trust score 44/100 per a third-party scanner). `DOCUMENTATION_CLAIM_ONLY`. No public spec, source, or on-chain reference to a "Pumpologia" SEAL→CLAIM mechanism could be located.
- **Conclusion: "Pumpologia" as a named protocol is NOT PUBLICLY VERIFIABLE.** See §4 for what the PAPER token actually shows on chain.

---

## 2. Universal / BRC-20 wire protocol

Source of truth: `Simplicity/src/services/parser.py`, `Simplicity/src/services/validator.py`, `Simplicity/src/services/processor.py`, `Simplicity/src/utils/decimal_conversion.py`, `Simplicity/src/utils/bitcoin.py` at pinned SHA `ba56635…`; cross-checked against `Protocol/README.md` and `OPI/OPI/*.md`.

### 2.1 Namespace / wire identifier

- The wire identifier is the **standard BRC-20 namespace**: every payload begins `{"p":"brc-20", …}`. `SOURCE_VERIFIED` (`parser.py` line 151 requires `"p":"brc-20"`; lines 198–212 reject any other `p` value). The Protocol README states it "maintains full backward compatibility with the original BRC-20 shared namespace". `SOURCE_VERIFIED`.
- There is **no separate "universal" identifier** on the wire — the "Universal" extension is expressed by *where* the payload lives (`OP_RETURN` instead of Ordinals witness) and by additional `op` values, not by a different `p`. `SOURCE_VERIFIED` + `INFERENCE`.
- Valid `op` values accepted by the parser: `deploy`, `mint`, `transfer`, `test_opi`, `burn`, `swap`. `SOURCE_VERIFIED` (`parser.py` lines 221, 289).

### 2.2 Deploy JSON

Canonical (implementation) shape, `SOURCE_VERIFIED` (`parser.py::_validate_deploy_fields`, `validator.py::validate_deploy`, `processor.py::process_deploy`):

```json
{"p":"brc-20","op":"deploy","tick":"FROG","m":"1000000000","l":"1000000000"}
```

| Field | Meaning | Rules (`SOURCE_VERIFIED`) |
|---|---|---|
| `p` | protocol | must be `"brc-20"` |
| `op` | operation | must be `"deploy"` |
| `tick` | ticker | non-empty string; uppercased by indexer; `y` prefix reserved for Curve yTokens |
| `m` | max supply | string; must be a valid amount; unique ticker enforced |
| `l` | limit per mint | string; **optional** — if absent/`null`, minting is **not allowed** |

- `ON_CHAIN_VERIFIED` confirmation: PAPER deploy (tx §4) used exactly `{"p":"brc-20","op":"deploy","tick":"PAPER","m":"21000000","l":"21000000"}` — the `m`/`l` keys.
- **Spec/implementation discrepancy to flag:** `Protocol/README.md` §2 and §5 rule 5 say `"max"` is an alias for `"m"` and `"lim"` an alias for `"l"` ("Flexible Keys"). `DOCUMENTATION_CLAIM_ONLY`. The Simplicity code at the pinned SHA reads **only** `operation.get("m")` and `operation.get("l")` — the alias is **not implemented**. `SOURCE_VERIFIED`. On-chain reality uses `m`/`l`. A deploy that used `max`/`lim` would be rejected by the current indexer (`INFERENCE`).

### 2.3 Mint JSON

```json
{"p":"brc-20","op":"mint","tick":"FROG","amt":"1000000000"}
```

- `amt` is a string; must be a valid amount; `amt ≤ l` (per-mint limit); cumulative minted `≤ m`. `SOURCE_VERIFIED` (`validator.py::validate_mint`, `validate_mint_overflow`).
- `ON_CHAIN_VERIFIED` confirmation: PAPER mint (tx §4) used `{"p":"brc-20","op":"mint","tick":"PAPER","amt":"21000000"}`.

### 2.4 Transfer JSON

```json
{"p":"brc-20","op":"transfer","tick":"FROG","amt":"3911"}
```

- Debits `amt` from sender, credits `amt` to recipient; sender balance must be sufficient. `SOURCE_VERIFIED`.
- `ON_CHAIN_VERIFIED` confirmation: PAPER claim/transfer (tx §4) used `{"p":"brc-20","op":"transfer","tick":"paper","amt":"3911"}` — note **lowercase `"paper"`** on the wire; the indexer normalizes tickers to uppercase (see §2.8), so it resolves to `PAPER`. `ON_CHAIN_VERIFIED` + `SOURCE_VERIFIED` (`processor.py` lines 168–176).

### 2.5 Burn JSON

- `burn` is in the parser's valid-op list (`SOURCE_VERIFIED`), but only the Wrap token burn (`tick:"W"`) is implemented; a generic burn is a no-op in the current code. `SOURCE_VERIFIED` (`processor.py` lines 431–441).

### 2.6 OP_RETURN position and output topology

- For `mint` and `transfer`, the OP_RETURN **must be the first output (`vout[0]`)** and there must be **exactly one** OP_RETURN output. `SOURCE_VERIFIED` (`parser.py::_extract_op_return_first_position_only`, lines 96–132).
- For `deploy`, the parser accepts OP_RETURN at any position, but `Protocol/README.md` §2 requires `deploy` OP_RETURN at `vout[0]` too. `SOURCE_VERIFIED` + `DOCUMENTATION_CLAIM_ONLY` (spec stricter than parser). All observed PAPER txs put OP_RETURN at `vout[0]`. `ON_CHAIN_VERIFIED`.
- **Recipient output = the first valid (non-OP_RETURN) output immediately after the OP_RETURN**, i.e. `vout[op_return_index + 1]`. `SOURCE_VERIFIED` (`validator.py::get_output_after_op_return_address`; Protocol README "Operation Binding" rule).
- Deploy's `vout[1]` is a structurally-required "dummy" recipient (commonly the deployer's own change address). `DOCUMENTATION_CLAIM_ONLY` (Protocol README §2) — corroborated by PAPER deploy (`vout[1]` = deployer address). `ON_CHAIN_VERIFIED`.
- Payload size: spec says JSON ≤ **80 bytes** (`DOCUMENTATION_CLAIM_ONLY`, Protocol README rule 3); the parser internally permits up to 2000 bytes (`SOURCE_VERIFIED`, `parser.py::max_op_return_size = 2000`). Flag: the indexer is more permissive than the spec.

### 2.7 Recipient and sender derivation

- **Recipient** = address of `vout[op_return_index + 1]`, taken from `scriptPubKey.addresses[0]`, else `scriptPubKey.address`, else `extract_address_from_script(hex)` which supports **P2PKH, P2SH, P2WPKH, P2WSH, P2TR**. `SOURCE_VERIFIED` (`bitcoin.py::extract_address_from_script`).
  - Implementation caveat: the fallback script→address path builds bech32/bech32m strings **without a checksum** ("simplified"); in practice the indexer relies on RPC-provided `addresses`/`address`. `SOURCE_VERIFIED` (`bitcoin.py` lines 67–83).
- **Sender** = the address funding **input 0 (`vin[0]`)**, resolved by looking up the previous output (UTXO) of `vin[0]`. `SOURCE_VERIFIED` (`processor.py::get_first_input_address`, `utxo_service.get_input_address`).
  - **Marketplace exception (indexer-only):** within an emergency block range, a marketplace transfer's sender is taken from `vin[1]` (fallback `vin[0]`). `SOURCE_VERIFIED` (`processor.py` lines 181–206, 1592–1614). The canonical/protocol rule for crafting PSBTs is **input 0 = sender**. `SOURCE_VERIFIED` (`SKILL.md` §"Universal BRC-20 & OPI: canonical rules").

### 2.8 Ticker rules

- Non-empty string; any length that fits the payload (spec: 80 bytes). `SOURCE_VERIFIED` (`parser.py::validate_ticker_format`).
- Indexer **normalizes to uppercase** (`tick.upper()`), so `PAPER`, `Paper`, `paper` all resolve to `PAPER`. `SOURCE_VERIFIED` (`processor.py` lines 168–176) + `ON_CHAIN_VERIFIED` (lowercase `paper` transfer indexed as `PAPER`).
- `y`-prefixed tickers are reserved for Curve yTokens; a `deploy` with a `y` prefix is rejected. `SOURCE_VERIFIED` (`processor.py::process_deploy`).

### 2.9 Supply rules

- `m` = max supply (string, must be valid amount). `SOURCE_VERIFIED`.
- `l` = per-mint limit; **if `l` is null/absent, minting is rejected** ("Minting requires a valid limit_per_op"). `SOURCE_VERIFIED` (`validator.py` lines 98–104).
- Each mint `amt ≤ l`; cumulative minted `≤ m`. `SOURCE_VERIFIED` (`validator.py::validate_mint`, `validate_mint_overflow`).
- No other per-address or per-mint caps beyond `l` and `m`.

### 2.10 Precision / decimals

- Simplicity stores amounts as `Decimal` with **`DEFAULT_SCALE = 8`** decimal places; DB columns are `Numeric(precision=38, scale=8)`. `SOURCE_VERIFIED` (`decimal_conversion.py`, `models/deploy.py`).
- On-chain JSON amounts are plain integer strings with no decimal point (e.g. `"21000000"`). `ON_CHAIN_VERIFIED`.
- The WhiteNode ticker API reports a `"decimals": 9` metadata field for every ticker (including PAPER), while balances are rendered with 8 decimal places (e.g. `"20978893.00000000"`). `ON_CHAIN_VERIFIED` (live API). The `9` vs source `8` is an unexplained WhiteNode-side metadata discrepancy — treat `8` as authoritative for the indexer (`INFERENCE`).

---

## 3. WhiteNode marketplace semantics

### 3.1 Identity and API surface

- WhiteNode = the "Universal — The BRC-20 Extended" marketplace/frontend at `www.whitenode.co`; JSON API at `api.whitenode.co`. `ON_CHAIN_VERIFIED` (live site/API).
- Endpoints used by the opool.space client (`SOURCE_VERIFIED`, `opool.space/src/app/services/whitenode.service.ts` and `whitenode-api.service.ts`):
  - `GET /api/brc20/tickers`
  - `GET /api/brc20/tickers/{tick}`
  - `GET /api/brc20/addresses/{address}/tickers-balance`
  - `GET /api/market/v1/brc20/tickers/{tick}/trades?limit=N`
  - `POST /market/v1/brc20/utxos` (header `X-Custom-Secret`; SDK docs referenced as `https://sdk.txspam.lol/api-docs/`)
- Ticker info shape includes: `ticker`, `decimals`, `max_supply`, `limit_per_mint`, `deploy_tx_id`, `creator_address`, `remaining_supply`, `minted`, `current_supply`, `circulating_supply`, `total_locked`, `holders`, `is_curve`. `ON_CHAIN_VERIFIED` (live API response).

### 3.2 Marketplace transfer topology (on-chain trade)

The Simplicity indexer classifies a `transfer` as a **marketplace** transfer (vs. simple peer-to-peer) by inspecting input signatures. `SOURCE_VERIFIED` (`processor.py::classify_transfer_type`, `_validate_early_marketplace_template`, `_validate_new_marketplace_template`):

- **Sighash mode required:** `SIGHASH_SINGLE | SIGHASH_ANYONECANPAY` = byte **`0x83`**. `SOURCE_VERIFIED` (`bitcoin.py::is_sighash_single_anyonecanpay`).
- **New template (blocks ≥ 901350):**
  - ≥ 3 inputs;
  - first **two** inputs are from the **same address** (skipped only in an emergency block range);
  - first two inputs both signed with `0x83`;
  - ≥ 3 **distinct** addresses across inputs.
- **Early template (blocks < 901350):** ≥ 3 inputs, at least one input signed `0x83`, ≥ 3 distinct addresses.
- **Sender** = input 0 (input 1 only in the emergency range); **recipient** = output immediately after the OP_RETURN. `SOURCE_VERIFIED`.
- Non-marketplace transfers use plain input-0 authorization; the opool.space app's own OP_RETURN mint PSBTs sign with `SIGHASH_ALL` (`0x01`). `SOURCE_VERIFIED` (`op-return-psbt-builder.service.ts` lines 330–332).

**Interpretation for trading Cove FROG on WhiteNode:** a sale is a single Bitcoin tx with ≥3 inputs (the two buyer/funder inputs from one address using `0x83`, plus the seller's token input), one OP_RETURN `transfer` (`FROG`) whose next output is the buyer, and (for BTC payment) the seller receiving sats. The Universal indexer recognizes the `0x83` pattern as the marketplace template and applies the input-0/input-1 sender rule. `INFERENCE` (synthesis of the source template; the exact multi-party PSBT is the Protocol README's "Two-Party Atomic Swap (PSBT)" pattern, `DOCUMENTATION_CLAIM_ONLY`).

---

## 4. Pumpologia SEAL → CLAIM → Universal flow + decoded PAPER txids

### 4.1 What "Pumpologia" is

- **No public GitHub repo, no spec, no source, no on-chain "Pumpologia" marker was found.** `SOURCE_VERIFIED` (negative searches). Only the low-trust `pumpologia.com` domain exists. `DOCUMENTATION_CLAIM_ONLY`.
- Therefore the *named* "Pumpologia SEAL→CLAIM→Universal" flow is **NOT PUBLICLY VERIFIABLE / EVIDENCE INSUFFICIENT** as a distinct protocol. What **is** verifiable is the PAPER token's actual on-chain lifecycle on Universal, which strongly resembles a "seal then distribute" launch.

### 4.2 PAPER token — decoded on-chain lifecycle (all `ON_CHAIN_VERIFIED`, via blockstream.info)

Ticker `PAPER` exists on Universal BRC-20 (WhiteNode indexer). Metadata: `decimals` 9 (see §2.10), `max_supply` 21,000,000, `limit_per_mint` 21,000,000, `minted` 21,000,000, `remaining_supply` 0, `is_curve` false, 9 holders, 0 marketplace trades. `ON_CHAIN_VERIFIED`.

**Fully decoded txids (I decoded the OP_RETURN bytes myself):**

| Role | txid | Block | OP_RETURN JSON (decoded) |
|---|---|---|---|
| Deploy ("SEAL") | `b1ad7e21874988b42295bb12e0e579964cae28e12e6ffb296f0aa1b4747fec49` | 963301 | `{"p":"brc-20","op":"deploy","tick":"PAPER","m":"21000000","l":"21000000"}` |
| Mint — full supply to creator ("SEAL") | `db1f2bf28739c79b9aefe2d3cec9bd54411d22fb74b843b5a5fd4dbfd5c4a97b` | 963303 | `{"p":"brc-20","op":"mint","tick":"PAPER","amt":"21000000"}` (recipient `vout[1]` = creator) |
| Transfer to a claimer ("CLAIM") — example | `22da0a9a6649c6d06949d03ae5fc67123af37e07b81cc1f779c82b2ac8b527f8` | 967403 | `{"p":"brc-20","op":"transfer","tick":"paper","amt":"3911"}` (recipient `vout[1]` = `bc1pm3h76…9d05`) |

**Creator address (deployer/treasury):** `bc1pexgd43p56cmengjk0qzwcvx9yynnrgm20wpth97078pd285h5f4qtkvvlk`.

**Transfer/claim txids I observed structurally (from `address/<creator>/txs`) but did not individually decode each OP_RETURN** — they follow the identical OP_RETURN→recipient→change pattern: `fe78624a3db3af5badac84cb893a46fd6c5a3ed3514a76f92b254eaa0b408ce1`, `14c6901ba3f8ebcc78f05c13e71fbf666017017a74efa4460b2da27e3421418d`, `577647394b5633190dbec748ea9fa8f12d916d4daa68c15bdb4630830df2ba41`, `d24ac49ee6ad89a0ddf871be591fafbffad5aea701f0d3924661e75a74726191`, `f2f5003094c54c611abc853e86b6bc88a90419494bbbcbbf8b80811be8979b6d`, `01005ff9f6a5cb22ee05686fa19ae3421a4a6b6f17e3eabea0918604af6d3b5e`, `74f7ff93004ad7d65610d5b663b25fb2fa7a3f2a4e2aaa9f0debb7e6fd9f4511`. `ON_CHAIN_VERIFIED` (structure).

**Resulting distribution (holders, `ON_CHAIN_VERIFIED` via WhiteNode API):** creator holds `20,978,893`; 8 claimers hold `11,400`, `5,303`, `3,911`, `215`, `100`, `83`, `50`, `45`. Sum = **21,000,000** exactly.

**Interpretation (`INFERENCE`):** the PAPER "SEAL → CLAIM → Universal" flow is, in wire terms, exactly:

1. **SEAL** = `deploy` (`m` = total, `l` = total) then a **single full-supply `mint` to the creator/treasury address** (two txs, blocks 963301/963303; not the atomic single-tx "SOON" pattern from the Protocol README).
2. **CLAIM** = standard `transfer` OP_RETURNs from the treasury to individual claimers.
3. **Universal** = the token lives natively on Universal (WhiteNode/Simplicity) from block 963301.

There is **no burn, no lock-and-mint, no curve** (`is_curve:false`) in the PAPER evidence. `ON_CHAIN_VERIFIED` + `INFERENCE`.

---

## 5. Cove FROG → Universal FROG graduation mechanisms and the supply invariant

### 5.1 Mechanisms the Universal ecosystem actually provides

| Mechanism | Source support | Implementation status at pinned SHA | Relevant to FROG? |
|---|---|---|---|
| **Pre-deployed Universal supply** (deploy + single full-supply mint to treasury, then transfer-out) | Protocol README §3 Example 2 ("Atomic Deploy and Full-Supply Mint"); whitenode.co/docs "Launch a new token and secure the entire supply in a treasury address instantly"; **PAPER on chain** | `deploy`/`mint`/`transfer` fully implemented; atomic multi-op deploy+mint is labeled "(SOON)" | **YES — this is what PAPER did** |
| **Burn/lock-and-mint bridge** (OPI-0 `no_return` / `bridge`, Ordinals→Universal) | `OPI/OPI/OPI-000-bridge.md` (atomic burn-to-mint, Hash Preimage Covenant, conservation of mass) | **Draft; NOT implemented** — `bridge`/`no_return` absent from parser valid-ops and from `ENABLED_OPIS` | Only if "Cove FROG" were a legacy Ordinals BRC-20 inscription |
| **Mint-on-claim / curve emission** (OPI-2 Curve: rewards minted ex-nihilo at claim) | `OPI/OPI/OPI-002-curve.md` ("Rewards are minted ex-nihilo … at the moment of claim … eliminating pre-mined supplies") | Implemented (`curve` in deploy, `swap init/exe`, CurveConstitution, yTokens) | No — Curve mints *reward* tokens on a schedule; it does not migrate a pre-existing 1B supply; PAPER is `is_curve:false` |
| **One-time issuer / full-supply mint** | same as pre-deployed supply (a single mint is de-facto a one-time issuance) | Implemented | Subsumed by pre-deployed supply |
| Vault (OPI-4), Predict (OPI-5) | Draft specs | Not implemented | No |

### 5.2 Which mechanism the evidence supports

**Pre-deployed Universal supply.** `INFERENCE`, grounded in `ON_CHAIN_VERIFIED` (PAPER) + `SOURCE_VERIFIED` (Protocol README Example 2 / whitenode docs). Concretely:

1. **Deploy** — `{"p":"brc-20","op":"deploy","tick":"FROG","m":"1000000000","l":"1000000000"}`
2. **Mint the full supply once** — `{"p":"brc-20","op":"mint","tick":"FROG","amt":"1000000000"}` with `vout[op_return_index+1]` = the launchpad **treasury/issuer address**. (Or two mints: `840000000` public + `160000000` treasury, both ≤ `m` and ≤ `l`.)
3. **Retire the CRC curve positions** as claims are exercised (off-Universal bookkeeping of the launchpad; see §5.4 caveat).
4. **Distribute on claim** — for each graduating holder, a `transfer` from the treasury: `{"p":"brc-20","op":"transfer","tick":"FROG","amt":"<amount>"}` with the next output = the holder. This is exactly the PAPER claim pattern.
5. **Trade** on WhiteNode via the marketplace transfer template (§3.2).

### 5.3 The supply invariant

> **(unclaimed Cove amount) + (claimed Universal amount) = legitimate holder amount**

- On the **Universal ledger**, this holds **automatically** because total supply is minted exactly **once** (`m` = 1,000,000,000), and every subsequent distribution is a `transfer` (debit treasury → credit holder), never a new `mint`. Therefore `Σ(Universal balances) = 1,000,000,000` at all times, and "circulating" = `Σ(balances) − treasury_balance` = the claimed amount. `SOURCE_VERIFIED` (supply-capped mint + transfer-only accounting) + `INFERENCE`.
- Mapping to the invariant: the "unclaimed Cove amount" is represented on Universal by the **treasury's remaining balance**; the "claimed Universal amount" is the sum transferred out to holders. `INFERENCE`.
- The 840,000,000 "public" portion is simply the amount destined to be transferred out to public claimers; the 160,000,000 remains treasury-held. No second 1B supply is ever created. `INFERENCE`.

### 5.4 The honest caveat (cross-ledger duplication)

The invariant above is airtight **within** Universal. The remaining risk is **double-counting between the CRC curve ledger and the Universal ledger** during the transition: if a "Cove FROG" unit exists on CRC *and* a "FROG" unit is transferred on Universal for the same holder without retiring the CRC unit, the holder temporarily holds two claims. The available public evidence does **not** show how any launchpad retires the CRC side atomically. `INFERENCE`.

The only Universal-native source mechanism that provably prevents cross-ledger inflation is **OPI-0** (`no_return`/`bridge`), whose explicit rule is *"Conservation of Mass: Total Universal tokens minted MUST equal total Legacy ordinals burned"* and *"No inflation: Universal tokens cannot exceed burned Legacy tokens"*. `SOURCE_VERIFIED` (`OPI-000-bridge.md`). But OPI-0 is **Draft and not implemented** in Simplicity at the pinned SHA (`SOURCE_VERIFIED`), and PAPER did not use it (`ON_CHAIN_VERIFIED`).

Therefore: **the specific graduation mechanism for Cove FROG is "pre-deployed Universal supply" (with transfer-on-claim), and the cross-ledger retirement step is NOT publicly verifiable from the available source/on-chain evidence.** If the CRC curve is a legacy Ordinals BRC-20 ledger, the settlement would need OPI-0 (not yet live); if CRC is the launchpad's own off-chain/private ledger, its retirement is an off-chain concern the Universal indexer cannot see.

---

## 6. Recommendation

For Cove FROG (1,000,000,000 supply; 840,000,000 public), given current (pinned-SHA) Universal support:

1. **Deploy** `FROG` on Universal with `{"p":"brc-20","op":"deploy","tick":"FROG","m":"1000000000","l":"1000000000"}` (use `m`/`l`, not `max`/`lim` — the alias is unimplemented).
2. **Mint once** `{"p":"brc-20","op":"mint","tick":"FROG","amt":"1000000000"}` to the launchpad treasury address (the output immediately after the OP_RETURN).
3. **Retire CRC positions** at claim time (launchpad-side), and **transfer** the corresponding `FROG` amount from the treasury to each holder (`{"p":"brc-20","op":"transfer","tick":"FROG","amt":"…"}`, recipient = output after OP_RETURN). This mirrors the verified PAPER claim pattern.
4. **Never mint again.** Distribution is transfer-only; the supply invariant (§5.3) then holds by construction.
5. **Trading on WhiteNode** uses the `SIGHASH_SINGLE|ANYONECANPAY` (0x83) marketplace transfer template (§3.2).

**Insufficient-evidence items** (state these to stakeholders honestly):
- The "Pumpologia" protocol does not exist in any public source — its SEAL→CLAIM labels are unverifiable.
- Atomic cross-ledger (CRC→Universal) settlement would require **OPI-0**, which is Draft and not implemented at pinned SHA `ba56635…`. Until it ships (or the launchpad publishes a verifiable CRC-retirement rule), the cross-ledger half of the no-double-spend guarantee is a **launchpad off-chain commitment**, not a chain-enforced invariant.
- The `max`/`lim` alias and the `decimals:9` label are documentation/API inconsistencies; rely on `m`/`l` and 8-decimal internal precision.

---

## 7. Classification table

| # | Claim | Classification |
|---|---|---|
| 1 | Simplicity repo default branch is `main`, HEAD `ba566350f084e4d75c05858de4c0d1e5b52f729f` | `SOURCE_VERIFIED` |
| 2 | Protocol repo HEAD `0a712baa…`; OPI `bb5874a6…`; opool.space `2f4c17db…`; opool_index `b4aa544c…`; agora `eadc4731…` (all `main`) | `SOURCE_VERIFIED` |
| 3 | Wire identifier is `"p":"brc-20"`; no separate "universal" namespace | `SOURCE_VERIFIED` |
| 4 | Valid ops: deploy, mint, transfer, test_opi, burn, swap | `SOURCE_VERIFIED` |
| 5 | Deploy fields `m` (max supply) and `l` (per-mint limit, optional) | `SOURCE_VERIFIED` |
| 6 | PAPER deploy OP_RETURN `{"p":"brc-20","op":"deploy","tick":"PAPER","m":"21000000","l":"21000000"}` at tx `b1ad7e21…fec49` block 963301 | `ON_CHAIN_VERIFIED` |
| 7 | Protocol README says `max`/`lim` are aliases for `m`/`l` ("Flexible Keys") | `DOCUMENTATION_CLAIM_ONLY` |
| 8 | Simplicity reads only `m`/`l`; alias not implemented | `SOURCE_VERIFIED` |
| 9 | Mint JSON `{"…","op":"mint","tick":…,"amt":…}`; `amt ≤ l`; cumulative `≤ m`; mint disallowed if `l` absent | `SOURCE_VERIFIED` |
| 10 | PAPER mint OP_RETURN `{"p":"brc-20","op":"mint","tick":"PAPER","amt":"21000000"}` at tx `db1f2bf2…a97b` block 963303 | `ON_CHAIN_VERIFIED` |
| 11 | Transfer JSON `{"…","op":"transfer","tick":…,"amt":…}` | `SOURCE_VERIFIED` |
| 12 | PAPER claim transfer `{"p":"brc-20","op":"transfer","tick":"paper","amt":"3911"}` at tx `22da0a9a…527f8` block 967403 | `ON_CHAIN_VERIFIED` |
| 13 | Ticker normalization is uppercase (case-insensitive matching) | `SOURCE_VERIFIED` + `ON_CHAIN_VERIFIED` |
| 14 | OP_RETURN must be `vout[0]` for mint/transfer; recipient = `vout[op_return_index+1]` | `SOURCE_VERIFIED` |
| 15 | Sender = `vin[0]` (UTXO prevout); marketplace emergency range uses `vin[1]` | `SOURCE_VERIFIED` |
| 16 | Recipient address derived from P2PKH/P2SH/P2WPKH/P2WSH/P2TR scripts | `SOURCE_VERIFIED` |
| 17 | Fallback bech32/bech32m address construction is checksum-less ("simplified") | `SOURCE_VERIFIED` |
| 18 | Simplicity precision is 8 decimals (`DEFAULT_SCALE=8`, `Numeric(38,8)`) | `SOURCE_VERIFIED` |
| 19 | WhiteNode API reports `"decimals":9` for tickers; balances show 8 dp | `ON_CHAIN_VERIFIED` (metadata) |
| 20 | JSON payload ≤ 80 bytes per spec; parser allows ≤ 2000 bytes | `DOCUMENTATION_CLAIM_ONLY` (spec) + `SOURCE_VERIFIED` (parser) |
| 21 | Marketplace transfer requires `SIGHASH_SINGLE\|ANYONECANPAY` (0x83); new template: ≥3 inputs, first two same address & 0x83, ≥3 distinct addresses | `SOURCE_VERIFIED` |
| 22 | opool.space OP_RETURN mint PSBTs use `SIGHASH_ALL` (0x01) | `SOURCE_VERIFIED` |
| 23 | WhiteNode is whitenode.co (marketplace), API api.whitenode.co; not a GitHub repo | `ON_CHAIN_VERIFIED` + `SOURCE_VERIFIED` |
| 24 | WhiteNode API endpoints `/api/brc20/tickers`, `/tickers/{tick}`, `/trades`, `/utxos`, etc. | `SOURCE_VERIFIED` |
| 25 | PAPER has 9 holders; creator 20,978,893 + 8 claimers = 21,000,000 exactly; 0 trades | `ON_CHAIN_VERIFIED` |
| 26 | "Pumpologia" GitHub repo/org/code does not exist; only low-trust `pumpologia.com` domain | `SOURCE_VERIFIED` (negative) + `DOCUMENTATION_CLAIM_ONLY` |
| 27 | "Pumpologia SEAL→CLAIM→Universal" is a distinct named protocol | **NOT PUBLICLY VERIFIABLE** (explicitly stated) |
| 28 | PAPER lifecycle = deploy → full-supply mint → transfer distribution (no burn/curve/bridge) | `ON_CHAIN_VERIFIED` + `INFERENCE` |
| 29 | OPI-0 `no_return`/`bridge` is the burn-to-mint migration (conservation of mass) | `SOURCE_VERIFIED` |
| 30 | OPI-0 is Draft and NOT implemented in Simplicity at pinned SHA | `SOURCE_VERIFIED` |
| 31 | OPI-2 Curve mints rewards ex-nihilo at claim; no pre-mine | `SOURCE_VERIFIED` |
| 32 | OPI-2 Curve implemented in Simplicity (curve/swap/yToken); PAPER `is_curve:false` | `SOURCE_VERIFIED` + `ON_CHAIN_VERIFIED` |
| 33 | Supported FROG mechanism = pre-deployed Universal supply (deploy → one full mint → transfer-out) | `INFERENCE` (grounded in #6/#10/#12 + Protocol Example 2) |
| 34 | Invariant (unclaimed Cove) + (claimed Universal) = legitimate holder amount holds on the Universal ledger by single-mint + transfer-only | `SOURCE_VERIFIED` + `INFERENCE` |
| 35 | Cross-ledger (CRC→Universal) atomic retirement requires OPI-0 (not live); otherwise it is an off-chain commitment | `INFERENCE` |

---

### Appendix A — data sources / how to reproduce

- Repos cloned under `/tmp/universal-research/` (not committed). Pin commands: `git clone … && git rev-parse HEAD`.
- PAPER decode: `curl https://blockstream.info/api/tx/<txid>` and `/tx/<txid>/hex`; OP_RETURN hex `7b22…7d` decodes to the JSON shown.
- WhiteNode live API: `curl https://www.whitenode.co/api/brc20/tickers/PAPER` (and `/holders`, `/trades`).
- Spec docs: `Protocol/README.md`, `OPI/OPI/OPI-000-bridge.md`, `OPI/OPI/OPI-002-curve.md`, `https://www.whitenode.co/docs`.

### Appendix B — explicit "not found / insufficient" statements

1. **Pumpologia repository:** not found (GitHub org/repo/code search). No SHA, no URL.
2. **Pumpologia SEAL→CLAIM→Universal mechanism:** not verifiable as a distinct protocol; only the PAPER on-chain lifecycle is verifiable, and it is plain deploy→mint→transfer.
3. **WhiteNode GitHub repo:** does not exist in this ecosystem; WhiteNode is the hosted marketplace whitenode.co (source-visible only through its client integration in opool.space).
4. **Atomic deploy+mint single-tx for a real token:** spec'd ("SOON", Protocol README §3 Example 2) but the observed PAPER token used separate deploy (963301) and mint (963303) transactions; no atomic real-token example was decoded.
