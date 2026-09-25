import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

/**
 * OFFLINE mainnet key-generation ceremony (§ceremony). Generates the 1 Guardian
 * + 3 recovery keypairs, emits ONLY the x-only BIP340 pubkeys (32-byte
 * x-coordinate, no parity byte) to stdout, and writes each private key (hex) to
 * a SEPARATE file under a gitignored directory with mode 0600. Private keys are
 * NEVER printed to stdout and NEVER written into the repo tree.
 *
 * Run on an air-gapped machine:
 *   pnpm --filter @crclaunch/cove-vault ceremony-keys --out /Volumes/ceremony/keys
 */

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const KEY_ROLES = ["guardian", "recovery-1", "recovery-2", "recovery-3"] as const;

function xOnlyHex(priv: Buffer): string {
  // 33-byte compressed pubkey = <0x02|0x03> + 32-byte x; drop the parity byte.
  return Buffer.from(ECPair.fromPrivateKey(priv).publicKey.subarray(1)).toString("hex");
}

function main(): void {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outDir = resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1]! : ".ceremony/keys");

  mkdirSync(outDir, { recursive: true });

  const privateKeys = new Map<string, string>();
  for (const role of KEY_ROLES) {
    const file = resolve(outDir, `${role}.key`);
    if (existsSync(file)) {
      console.error(`refusing to overwrite existing key file: ${file}`);
      process.exit(1);
    }
    const priv = randomBytes(32);
    const privHex = priv.toString("hex");
    // Write ONLY to the gitignored path, mode 0600 (owner read/write).
    writeFileSync(file, privHex + "\n", { mode: 0o600 });
    privateKeys.set(role, privHex);
  }

  console.log("Key-generation ceremony complete.");
  console.log("");
  console.log("X-ONLY BIP340 PUBLIC KEYS (copy these into the profile):");
  for (const role of KEY_ROLES) {
    console.log(`  ${role.padEnd(12)} ${xOnlyHex(Buffer.from(privateKeys.get(role)!, "hex"))}`);
  }
  console.log("");
  console.log(`Private keys written to: ${outDir}/`);
  console.log("Storage checklist — store each private key SEPARATELY, offline:");
  console.log("  [ ] guardian.key    → hardware signer / KMS (never on the app host)");
  console.log("  [ ] recovery-1.key  → offline signer 1 (separate physical location)");
  console.log("  [ ] recovery-2.key  → offline signer 2 (separate physical location)");
  console.log("  [ ] recovery-3.key  → offline signer 3 (separate physical location)");
  console.log("  [ ] Confirm each file is mode 0600 and gitignored (never committed).");
  console.log("  [ ] Verify the x-only pubkeys above before funding or deploying anything.");
}

main();
