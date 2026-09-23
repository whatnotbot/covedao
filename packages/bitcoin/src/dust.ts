/**
 * Bitcoin Core relay-policy dust thresholds.
 *
 * This mirrors Bitcoin Core's `GetDustThreshold` (src/policy/policy.cpp):
 *
 *   dust = dustRelayFeeIn.GetFee(serializeSize(txout) + spendInputSize)
 *
 * with dustRelayFee = 3000 sat/kvB (3 sat/vB, the default) and the spend-input
 * size being 148 vbytes for non-witness and 67 vbytes for witness programs
 * (32 prevout + 4 index + 1 scriptSig len + 107/4 witness + 4 sequence).
 * `CFeeRate::GetFee` truncates (integer division), matching Core.
 *
 * Reference values at the default rate:
 *   P2PKH  (25-byte script)  → 546 sats
 *   P2WPKH (22-byte script)  → 294 sats
 *   P2TR   (34-byte script)  → 330 sats
 *
 * This is RELAY POLICY, not Cove consensus. The Cove validator uses it to
 * require relay-safe anchor/continuation outputs; it never conflates a
 * protocol semantic amount with a policy dust amount.
 */

export const DUST_RELAY_FEE_SAT_PER_KVB = 3000n; // 3 sat/vB

/**
 * True for a witness program: OP_0 or OP_1..OP_16 followed by a 2..40-byte
 * push (P2WPKH/P2WSH/P2TR and future versions), matching Bitcoin Core's
 * `IsWitnessProgram`.
 */
export function isWitnessProgram(script: Uint8Array): boolean {
  if (script.length < 4) return false;
  const first = script[0]!;
  const len = script[1]!;
  const isVersion = first === 0x00 || (first >= 0x51 && first <= 0x60);
  if (!isVersion) return false;
  return len >= 2 && len <= 40 && script.length === 2 + len;
}

export function isP2WPKH(script: Uint8Array): boolean {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
}

export function isP2TR(script: Uint8Array): boolean {
  return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
}

/**
 * Bitcoin Core dust threshold for an output script, in satoshis, at the given
 * dust relay fee rate (default 3000 sat/kvB). Returns 0 for unspendable
 * scripts (OP_RETURN). Uses Core's integer-truncating GetFee.
 */
export function dustThreshold(
  script: Uint8Array,
  dustRelayFeeSatPerKvB: bigint = DUST_RELAY_FEE_SAT_PER_KVB,
): bigint {
  // Only OP_RETURN is unspendable. An empty script is anyone-can-spend and
  // Core treats it as spendable (dust = 471 at the default rate).
  if (script[0] === 0x6a) return 0n;

  // serializeSize(CTxOut) = 8 (nValue) + 1 (compact-size script len, len<253) + len.
  let nSize = 8 + 1 + script.length;
  if (isWitnessProgram(script)) {
    nSize += 32 + 4 + 1 + Math.floor(107 / 4) + 4; // 67 vbytes
  } else {
    nSize += 32 + 4 + 1 + 107 + 4; // 148 vbytes
  }
  // GetFee(nSize) = nSize * feePerKvb / 1000 (integer truncation, like Core).
  return (BigInt(nSize) * dustRelayFeeSatPerKvB) / 1000n;
}
