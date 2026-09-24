# Mainnet Recovery Key Ceremony

TOOLING READY ≠ CEREMONY COMPLETE. This document describes the required
procedure; it does not claim a ceremony happened.

## Design

2-of-3 threshold recovery (MAINNET1), lexicographic x-only key ordering. Private
recovery material is OFFLINE and never enters git/app/worker/Guardian/database.

## Procedure

1. Generate each of the 3 recovery keys on an independent, air-gapped machine
   (different geographic/organizational custodians).
2. Never generate more than one key per machine; never collect private material
   on a single online host.
3. Verify the public x-only keys out-of-band (compare hashes over an independent
   channel).
4. Commit ONLY the public x-only keys into the immutable mainnet profile.
5. Back up each private shard independently (hardware key / stamped offline).
6. Test restoration of each shard on a fresh offline machine.
7. Destroy temporary plaintext copies.
8. After public keys are committed, rebuild the vault and verify the golden
   scriptPubKey/merkle-root/output-key vectors match.
9. Run the recovery consensus matrix (regtest): before-CSV reject, 1/3 reject,
   2/3 accept, malformed reject, destination/fee mutation rejected by tooling.

## Hard rules

- No private recovery key in any online process (mainnet rejects
  `COVE_RECOVERY_PRIVATE_KEY_HEX`).
- Recovery is an explicit emergency ceremony, never an automatic background job.
