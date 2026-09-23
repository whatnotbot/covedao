# CRC.garden / PRECOP vs Cove

| Dimension | CRC.garden (live, on-chain) | PRECOP (documented) | PRECOP (implemented) | Cove (target) |
| --- | --- | --- | --- | --- |
| Output script | P2TR key-path | P2TR | P2TR key-path | P2TR |
| Internal key | user/operator HD key | generic `P` (unspecified) | **BIP-86 HD key (has key-path key)** | **NUMS (no key-path key)** |
| Script tree | none revealed | 5-leaf MAST | 3-leaf MAST (string-label leaves) | dual-leaf MAST |
| Recovery | n/a | `<144> OP_CSV OP_2DROP <pk> OP_CHECKSIG` | `<pk> OP_CHECKSIG` (no CSV) | `<144> OP_CSV OP_2DROP <owner> OP_CHECKSIG` |
| Execution | off-chain operator policy | Simplicity Bit Machine (claimed) | **Rust loop, string-label leaves** | off-chain Guardian policy + script-path CHECKSIG |
| State commitment | OP_RETURN JSON only | `Qₜ = P + H(Sₜ₊₁ ‖ CMR)·G` | key tweak via MAST root | `Q = NUMS + H_TapTweak(NUMS ‖ MAST)·G` |
| Envelope | `crc-20`/`ico-20` OP_RETURN JSON | Command-First OP_RETURN | n/a | CRC-style OP_RETURN (discovery only) |
| Balance authority | off-chain indexer | indexer (claimed "no indexer") | off-chain | **state-committed UTXO, not indexer** |

## Honest differences Cove must retain

1. **No key-path spend.** Cove uses a NUMS internal key; CRC/PRECOP-implementation
   use an HD key and sign via key-path.
2. **Recovery has a real CSV delay.** CRC/PRECOP-implementation recovery is
   single-sig with no timelock; the yellowpaper's 144-block OP_CSV is the target
   Cove mirrors.
3. **The execution predicate is honest about where it runs.** Cove's full
   curve/amounts policy runs off-chain in the Guardian (Phase 1.5 validation),
   then authorizes a **script-path** spend. PRECOP-implementation's "Simplicity"
   is a Rust loop mislabeled as a Bit Machine.
4. **OP_RETURN is signaling only.** CRC's OP_RETURN JSON is metadata for an
   off-chain indexer; Cove must never make that indexer the balance authority.
5. **State is a first-class commitment.** Cove commits state into the Taproot key
   (and the execution leaf), not only into an OP_RETURN blob.

## Where Cove deliberately converges on CRC/PRECOP mechanics

- Command-First output topology (OP_RETURN at output 0, vault/state next).
- Taproot MAST for path isolation (execution vs recovery).
- A documented, deterministic NUMS internal key (Cove's own; PRECOP papers do not
  publish one, so this is a **new** constant, flagged as such).
- The `<144> OP_CHECKSEQUENCEVERIFY OP_2DROP <pk> OP_CHECKSIG` recovery leaf shape
  (taken from the yellowpaper §4.3).
