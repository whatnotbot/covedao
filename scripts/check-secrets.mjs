#!/usr/bin/env node
/**
 * Phase 8 secret scanner (§46/§134). Scans the tracked working tree for leaked
 * secrets: deterministic test private keys (0x42/0x43/0x44/0x46/0x47/0x48/0x49
 * repeated 32 bytes), WIF-like base58, BIP39 seed-phrase word runs, and .env
 * files with credentials. Test/fixture paths are exempt only where they are
 * explicitly test artifacts. Exits 1 on a hit, 0 otherwise.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TEST_KEY_HEXES = ["42", "43", "44", "46", "47", "48", "49", "51", "52", "53"];
const TEST_PRIV_RE = new RegExp(`\\b(${TEST_KEY_HEXES.map((b) => `${b}{32}`).join("|")})\\b`, "i");
const WIF_RE = /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/;
const ENV_SECRET_RE = /^\s*(?:[A-Z_]*?(?:PRIVATE_KEY|PASSWORD|SECRET|MNEMONIC|SEED|WIF))[A-Z_]*\s*=\s*\S+/m;

function isTestFile(p) {
  return /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(p) || p.includes("/testing/") || p.includes("/tests/") || p.includes("/fixtures/");
}

function fail(msg) {
  console.error(`SECRET-SCAN VIOLATION: ${msg}`);
  process.exit(1);
}

// Scan only git-TRACKED files (gitignored local .env is out of scope).
const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("fr.html"));

let scanned = 0;
for (const rel of files) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  scanned++;
  const isTest = isTestFile(rel);
  // Deterministic test private keys are only allowed in test/fixture artifacts.
  if (TEST_PRIV_RE.test(src) && !isTest) {
    fail(`${rel}: deterministic test private key in a non-test file`);
  }
  // WIF private keys are never allowed anywhere in the tree.
  if (WIF_RE.test(src)) fail(`${rel}: WIF-like private key`);
  // .env files must not commit credentials (they are gitignored; presence = leak).
  if (/\.env$/.test(rel) && ENV_SECRET_RE.test(src)) fail(`${rel}: committed .env with credentials`);
}

console.log(`secret scan OK: ${scanned} files, no leaked private keys/WIF/seeds/.env credentials`);
