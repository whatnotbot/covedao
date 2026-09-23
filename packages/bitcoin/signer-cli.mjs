#!/usr/bin/env node
/**
 * Cove signet key-control verification + fresh-signer generation (Phase 0).
 *
 * Runs on a trusted owner-controlled machine ONLY. It NEVER prints a WIF,
 * seed or private key. Two independent derivations (ecpair and raw
 * pointFromScalar) must agree and match the expected address.
 *
 * Usage (from packages/bitcoin):
 *   node signer-cli.mjs verify --wif-file PATH --expect ADDRESS
 *   node signer-cli.mjs verify --wif-env ENV_VAR --expect ADDRESS
 *   node signer-cli.mjs generate --backup-file PATH   # prints address ONLY
 */
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.testnet; // signet shares testnet encodings

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Independent derivation path: privkey → pointFromScalar → script → address. */
function deriveIndependently(privkey) {
  const pub = ecc.pointFromScalar(privkey, true);
  if (!pub) throw new Error("pointFromScalar failed");
  const hash = bitcoin.crypto.hash160(pub);
  const script = Buffer.concat([Buffer.from([0x00, 0x14]), hash]);
  const address = bitcoin.address.toBech32(hash, 0, NETWORK.bech32);
  return { pubHex: Buffer.from(pub).toString("hex"), scriptHex: script.toString("hex"), address };
}

function deriveViaEcpair(wif) {
  let kp;
  try {
    kp = ECPair.fromWIF(wif, NETWORK);
  } catch (e) {
    throw new Error(`WIF decode failed (Base58Check/network): ${e.message}`);
  }
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network: NETWORK });
  return {
    pubHex: kp.publicKey.toString("hex"),
    scriptHex: p2wpkh.output.toString("hex"),
    address: p2wpkh.address,
    privateKey: kp.privateKey,
  };
}

function readWif() {
  const file = arg("--wif-file");
  if (file) return readFileSync(file, "utf8").trim();
  const env = arg("--wif-env");
  if (env) {
    const v = process.env[env];
    if (!v) throw new Error(`env var ${env} is empty`);
    return v.trim();
  }
  throw new Error("provide --wif-file PATH or --wif-env ENV_VAR");
}

const cmd = process.argv[2];
if (cmd === "verify") {
  try {
    const wif = readWif();
    const viaEcpair = deriveViaEcpair(wif);
    const viaManual = deriveIndependently(viaEcpair.privateKey);
    const expect = arg("--expect");
    const fieldsMatch =
      viaEcpair.pubHex === viaManual.pubHex &&
      viaEcpair.scriptHex === viaManual.scriptHex &&
      viaEcpair.address === viaManual.address;
    const addrMatch = expect ? viaEcpair.address === expect : true;

    console.log("WIF decode:            OK (Base58Check + testnet network + compressed)");
    console.log("address:               ", viaEcpair.address);
    console.log("scriptPubKey (P2WPKH): ", viaEcpair.scriptHex);
    console.log("compressed public key: ", viaEcpair.pubHex);
    console.log("independent derivation agrees:", fieldsMatch ? "YES" : "NO");
    console.log("matches expected address:     ", addrMatch ? "YES" : "NO");
    if (!fieldsMatch || !addrMatch) {
      console.error("\nKEY CONTROL FAILED: WIF does not derive the expected address.");
      process.exit(1);
    }
    console.log("\nKEY CONTROL VERIFIED: WIF derives the expected address.");
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
} else if (cmd === "generate") {
  const backup = arg("--backup-file");
  if (!backup) throw new Error("provide --backup-file PATH for the WIF backup");
  const kp = ECPair.makeRandom({ network: NETWORK });
  const viaManual = deriveIndependently(kp.privateKey);
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network: NETWORK });
  if (p2wpkh.address !== viaManual.address) throw new Error("internal derivation mismatch");

  await writeFile(backup, kp.toWIF() + "\n", { mode: 0o600 });
  console.log("Fresh signet P2WPKH signer generated.");
  console.log("Public address (fund THIS):", p2wpkh.address);
  console.log("scriptPubKey:             ", p2wpkh.output.toString("hex"));
  console.log("WIF backup written to:     ", backup, "(mode 0600, keep off-repo and secure)");
  console.log("DO NOT commit, print, or share the backup file.");
} else {
  console.error("Usage: signer-cli.mjs <verify --wif-file P --expect A | generate --backup-file P>");
  process.exit(1);
}
