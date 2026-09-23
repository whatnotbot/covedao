import * as bitcoin from "bitcoinjs-lib";

/**
 * The two Cove vault tapleaves.
 *
 * EXECUTION leaf — mirrors the PRECOP "Sovereign Routing" pattern (a curried
 * commitment the witness must reveal, followed by the authorizing signature)
 * under current mainnet rules:
 *
 *   <successorStateHash(32)> OP_EQUALVERIFY <guardianXOnly(32)> OP_CHECKSIG
 *
 * Witness: [guardian_sig(64), revealed_successorStateHash(32)].
 * The Guardian pre-executes the full Phase 1.5 transition policy OFF-CHAIN, and
 * only then produces the script-path CHECKSIG (which binds the actual outputs
 * via SIGHASH_DEFAULT). Bitcoin consensus enforces only the CHECKSIG + the
 * hash reveal; the curve/amount policy is Guardian-enforced.
 *
 * RECOVERY leaf — mirrors PRECOP yellowpaper §4.3 verbatim:
 *
 *   <144> OP_CHECKSEQUENCEVERIFY OP_2DROP <ownerXOnly(32)> OP_CHECKSIG
 *
 * Witness stack: [owner_sig(64), pad] — OP_CSV leaves the <144> operand on the
 * stack, so OP_2DROP drops it plus the single padding item, leaving [sig] for
 * the final OP_CHECKSIG. A 144-block relative timelock before the owner can
 * unilaterally exit.
 */

const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_2DROP = 0x6d;

export const RECOVERY_CSV_BLOCKS = 144;

/** Execution leaf: commit the successor state hash + require the Guardian CHECKSIG. */
export function buildExecutionLeaf(successorStateHash: Buffer, guardianXOnly: Buffer): Buffer {
  if (successorStateHash.length !== 32) {
    throw new Error(`successorStateHash must be 32 bytes, got ${successorStateHash.length}`);
  }
  if (guardianXOnly.length !== 32) {
    throw new Error(`guardianXOnly must be 32 bytes, got ${guardianXOnly.length}`);
  }
  return bitcoin.script.compile([
    successorStateHash,
    OP_EQUALVERIFY,
    guardianXOnly,
    OP_CHECKSIG,
  ]) as Buffer;
}

/** Recovery leaf: <144> OP_CHECKSEQUENCEVERIFY OP_2DROP <ownerXOnly> OP_CHECKSIG. */
export function buildRecoveryLeaf(ownerXOnly: Buffer): Buffer {
  if (ownerXOnly.length !== 32) {
    throw new Error(`ownerXOnly must be 32 bytes, got ${ownerXOnly.length}`);
  }
  return bitcoin.script.compile([
    bitcoin.script.number.encode(RECOVERY_CSV_BLOCKS),
    OP_CHECKSEQUENCEVERIFY,
    OP_2DROP,
    ownerXOnly,
    OP_CHECKSIG,
  ]) as Buffer;
}
