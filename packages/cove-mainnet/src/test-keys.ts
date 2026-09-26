import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/**
 * The private keys every regtest fixture, harness and test in this repo uses:
 * one byte repeated 32 times. Anyone can read them here, so anything they
 * control is public. KEEP IN SYNC with TEST_KEY_HEXES in
 * scripts/check-secrets.mjs (a test enforces it).
 */
export const KNOWN_TEST_KEY_BYTES = [0x42, 0x43, 0x44, 0x46, 0x47, 0x48, 0x49, 0x51, 0x52, 0x53] as const;

/** True when `hex` is one of the known test private keys (case-insensitive). */
export function isKnownTestPrivateKeyHex(hex: string): boolean {
  const h = hex.toLowerCase();
  return KNOWN_TEST_KEY_BYTES.some((b) => h === b.toString(16).padStart(2, "0").repeat(32));
}

interface Derived {
  xOnly: Set<string>;
  scripts: Set<string>;
}

let derived: Derived | null = null;

/**
 * Every public key and standard output script the known test keys control:
 * x-only keys, and P2WPKH, P2TR (key path), P2PKH and P2SH-P2WPKH scripts.
 */
function testKeyMaterial(): Derived {
  if (derived) return derived;
  const xOnly = new Set<string>();
  const scripts = new Set<string>();
  for (const b of KNOWN_TEST_KEY_BYTES) {
    const pubkey = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, b), true)!);
    const x = pubkey.subarray(1);
    xOnly.add(x.toString("hex"));
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey });
    scripts.add(p2wpkh.output!.toString("hex"));
    scripts.add(bitcoin.payments.p2tr({ internalPubkey: x }).output!.toString("hex"));
    scripts.add(bitcoin.payments.p2pkh({ pubkey }).output!.toString("hex"));
    scripts.add(bitcoin.payments.p2sh({ redeem: p2wpkh }).output!.toString("hex"));
  }
  derived = { xOnly, scripts };
  return derived;
}

/** True when an x-only key (hex) belongs to a known test private key. */
export function isKnownTestXOnly(hex: string): boolean {
  return testKeyMaterial().xOnly.has(hex.toLowerCase());
}

/** True when an output script (hex) is paid to a known test private key. */
export function isKnownTestScript(hex: string): boolean {
  return testKeyMaterial().scripts.has(hex.toLowerCase());
}
