# Key-generation ceremony

The offline key-generation tool lives at
`packages/cove-vault/src/ceremony-keys.ts` and is invoked from the repo root as:

```bash
pnpm cove:ceremony-keys --out /Volumes/ceremony/keys
```

## What it does

- Generates **1 Guardian + 3 recovery** keypairs using `crypto.randomBytes(32)`.
- Derives and prints only the **x-only BIP340 public keys** (32-byte x-coordinate,
  **no parity byte**) for the `guardianXOnly` + `recovery.pubkeys` profile fields.
- Writes each private key (hex) to a **separate** file
  (`guardian.key`, `recovery-1.key`, `recovery-2.key`, `recovery-3.key`) under
  `--out`, with **mode 0600**.
- **Never** writes a private key to the repo tree or to `stdout`; it refuses to
  overwrite an existing key file.

## Storage checklist

- [ ] `guardian.key` → the Guardian service's own machine ONLY (encrypted
      disk, mode 0600, set as `GUARDIAN_KEY_FILE`). It is a hot key: the
      Guardian signs every mint and redeem automatically. Never on the app/web
      host. The service refuses to start if the key does not match the
      profile's `guardianXOnly`.
- [ ] `recovery-1.key` → offline signer 1 (separate physical location).
- [ ] `recovery-2.key` → offline signer 2 (separate physical location).
- [ ] `recovery-3.key` → offline signer 3 (separate physical location).
- [ ] Confirm each file is `0600` and gitignored (the `--out` dir should be
      `.ceremony/` or an encrypted volume — never the repo).
- [ ] Verify the printed x-only pubkeys before funding or deploying anything.

The private-key files are for the operator's own offline storage only; the
**public** x-only values are what go into
`config/cove-v3-mainnet-profile.template.json`.
