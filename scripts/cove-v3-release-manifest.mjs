#!/usr/bin/env node
/**
 * Phase 8 release manifest generator (§48/§118). Emits a deterministic
 * COVE_V3_RELEASE_MANIFEST.json with the git commit, frozen protocol CMRs,
 * schema version, and a content hash — never any secrets. Operators verify the
 * manifest at startup so every component knows exactly which release/profile it
 * is running.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const CMR = {
  mint: "7fb27adf2db5458882daf976ba9325815f111b2f3b16eedb72e75f96de4269b2",
  redeem: "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56",
};

const manifest = {
  schemaVersion: 1,
  gitCommit: commit,
  generatedAt: new Date().toISOString(),
  protocol: {
    wire: "V2",
    state: "CoveStateV2",
    policyVersion: 3,
    curve: "stairs210",
    vaultProfileVersions: ["COVE_V3_VAULT_PROFILE_DEV1", "COVE_V3_VAULT_PROFILE_MAINNET1"],
    mintCmr: CMR.mint,
    redeemCmr: CMR.redeem,
    marketListingVersion: 1,
  },
  vaultProfile: {
    mainnet1: { recoveryThreshold: 2, recoveryKeyCount: 3 },
    dev1: { recoveryThreshold: 1, recoveryKeyCount: 1 },
  },
};

// Deterministic content hash (no property-order dependence: canonical string).
const canonical = [
  `commit=${commit}`,
  `mintCmr=${CMR.mint}`,
  `redeemCmr=${CMR.redeem}`,
  `policyVersion=3`,
].join("\n");
manifest.manifestHash = createHash("sha256").update(canonical).digest("hex");

const out = process.argv[2] ?? "COVE_V3_RELEASE_MANIFEST.json";
if (process.argv.includes("--write")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${out} (manifestHash ${manifest.manifestHash})`);
} else {
  console.log(JSON.stringify(manifest, null, 2));
}
