#!/usr/bin/env node
/**
 * Phase 8 readiness gate CLI (§144). Reads the committed public mainnet profile
 * (COVE_V3_MAINNET_PROFILE_PATH → JSON, no secrets) and reports the deterministic
 * readiness status. Code-level gates (frozen manifest, vault profile goldens,
 * double-sign, secret scan, recovery Core matrix) are proven by the
 * cove-v3-mainnet-readiness CI; this CLI focuses on profile completeness + the
 * operator decisions still required. Never broadcasts anything.
 */
import { readFileSync, existsSync } from "node:fs";

const path = process.env.COVE_V3_MAINNET_PROFILE_PATH ?? ".cove-v3-mainnet-profile.json";

function pass(name) { console.log(`${name.padEnd(28)} PASS`); return true; }
function fail(name, why) { console.log(`${name.padEnd(28)} FAIL — ${why}`); return false; }

let profile = null;
if (existsSync(path)) {
  try { profile = JSON.parse(readFileSync(path, "utf8")); } catch (e) { console.error(`cannot parse ${path}: ${e.message}`); }
}
const p = profile ?? {};

console.log("Cove V3 — mainnet readiness");
const ok = [
  ["release manifest", !!p.releaseManifestHash, "OWNER_DECISION_REQUIRED: release manifest hash"],
  ["activation height", Number.isInteger(p.activationHeight) && p.activationHeight > 0, "OWNER_DECISION_REQUIRED: COVE_V3_MAINNET_ACTIVATION_HEIGHT"],
  ["guardian public key", /^[0-9a-f]{64}$/i.test(String(p.guardianXOnly ?? "")), "OWNER_DECISION_REQUIRED: guardianXOnly (custody ceremony)"],
  ["recovery 2-of-3 keys", Array.isArray(p.recoveryPubkeys) && p.recoveryPubkeys.length >= 3 && p.recoveryPubkeys.every((k) => /^[0-9a-f]{64}$/i.test(k)), "OWNER_DECISION_REQUIRED: 3 recovery x-only pubkeys"],
  ["recovery CSV delay", Number.isInteger(p.recoveryCsvBlocks) && p.recoveryCsvBlocks > 0, "OWNER_DECISION_REQUIRED: recoveryCsvBlocks"],
  ["fee destination script", /^[0-9a-f]+$/i.test(String(p.feeScript ?? "")), "OWNER_DECISION_REQUIRED: feeScript"],
  ["buy fee bps", Number(p.buyFeeBps) > 0, "OWNER_DECISION_REQUIRED: MAINNET_BUY_FEE_BPS"],
  ["redeem fee bps", Number(p.redeemFeeBps) > 0, "OWNER_DECISION_REQUIRED: MAINNET_REDEEM_FEE_BPS"],
  ["p2p fee bps", Number(p.p2pFeeBps) > 0, "OWNER_DECISION_REQUIRED: MAINNET_P2P_FEE_BPS"],
].map(([name, cond, why]) => (cond ? pass(name) : fail(name, why)));

const allPass = ok.every(Boolean);
console.log("");
if (!profile) {
  console.log("NOT_READY — no committed mainnet profile (owner decisions required)");
} else if (allPass) {
  console.log("READY_FOR_CONTROLLED_MAINNET_CANARY (profile gates pass; operator ceremony required before any broadcast)");
} else {
  console.log("NOT_READY — owner decisions still required");
}
