#!/usr/bin/env node
/**
 * V3 production architecture gate (§4/§20). Production V3 application code
 * (apps/web production routes/lib/components + packages/cove-app) must NOT
 * import/use the legacy CRC adapter/mock/account-balance/graduation/DEX model.
 *
 *   - legacy protocol adapters (PrecopCRCAdapter / MockCRCAdapter / MockChainNode)
 *   - mock Bitcoin provider
 *   - quoteExactTokens (legacy primary-mint path)
 *   - authoritative balance table helpers (walletTokenBalances / listBalances*)
 *   - legacy listings/trades tables
 *   - DEX_ASK / DEX_BID / DEX_CANCEL
 *   - GRADUATED / GRADUATING / SOLD_OUT lifecycle
 *
 * Exceptions: demo/legacy paths (demo, for-crc, mainnet, liquidity, legacy).
 * Exits 1 with a precise message on violation; 0 otherwise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = [
  join(ROOT, "apps/web/src/app"),
  join(ROOT, "apps/web/src/lib"),
  join(ROOT, "apps/web/src/components"),
  join(ROOT, "packages/cove-app/src"),
];

const LEGACY_SEGMENTS = new Set(["demo", "for-crc", "mainnet", "liquidity", "legacy"]);

const FORBIDDEN_IMPORTS = ["@crclaunch/protocol"];

const FORBIDDEN_IDENTIFIERS = [
  "PrecopCRCAdapter",
  "MockCRCAdapter",
  "MockChainNode",
  "MockBitcoinProvider",
  "MockCanonicalCRCProvider",
  "quoteExactTokens",
  "walletTokenBalances",
  "listBalancesForWallet",
  "listBalances",
  "DEX_ASK",
  "DEX_BID",
  "DEX_CANCEL",
  "GRADUATED",
  "GRADUATING",
  "SOLD_OUT",
];

function fail(msg) {
  console.error(`V3-ARCHITECTURE VIOLATION: ${msg}`);
  process.exit(1);
}

function isLegacyPath(rel) {
  return rel.split("/").some((seg) => LEGACY_SEGMENTS.has(seg));
}

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(p);
  }
  return out;
}

let scanned = 0;
for (const root of SCAN_ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of collectFiles(root)) {
    const rel = file.slice(ROOT.length + 1);
    if (isLegacyPath(rel)) continue;
    const src = readFileSync(file, "utf8");
    scanned++;
    for (const line of src.split("\n")) {
      for (const imp of FORBIDDEN_IMPORTS) {
        if (line.includes(`"${imp}"`) || line.includes(`'${imp}'`)) {
          fail(`${rel}: imports forbidden "${imp}"`);
        }
      }
      for (const ident of FORBIDDEN_IDENTIFIERS) {
        if (new RegExp(`\\b${ident}\\b`).test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          fail(`${rel}: references forbidden "${ident}"`);
        }
      }
    }
  }
}

console.log(`V3 architecture gate OK: ${scanned} production files clean (no legacy CRC adapter/account/graduation/DEX)`);
