# Runbook — Emergency Recovery Procedure

## Detection

Guardian unavailable/dead, or suspected Guardian key compromise, or an operator
decision to exercise recovery.

## Automatic behavior

None. Recovery is NEVER automatic. No online service holds threshold recovery
authority. Guardian may halt backing signing (fail closed) while read-only
browsing continues where safe.

## Immediate operator action

1. Halt Guardian signing and disable new BUY/REDEEM.
2. Inspect the signing journal + audit chain: which backing outpoints were
   signed, and with which unsigned-tx digests.
3. Determine the current backing UTXO status in Core (unspent/confirmed).
4. Gather >= threshold recovery signers on independent OFFLINE machines.
5. Use `cove-recovery` to reconstruct the exact production vault from the
   committed profile, construct the recovery PSBT to the APPROVED destination,
   and display every input/output + fee.
6. Import independent signatures; finalize only after threshold.

## What must NOT be done

- Do not rotate keys by editing config (existing vault outputs commit the old keys).
- Do not broadcast without explicit `--broadcast` + human confirmation.
- Do not construct a replacement backing transition while a signed transition is
  unresolved.

## Recovery criteria / re-enable

Recovery tx confirmed at/above the CSV delay; destination and fee verified;
signing journal/audit reconciled. Re-enable only after operator review.
