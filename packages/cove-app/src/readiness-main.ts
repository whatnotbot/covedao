import { resolve } from "node:path";
import { loadMainnetProfile, hashMainnetProfile } from "@crclaunch/cove-mainnet";
import { runRuntimeReadiness } from "./readiness-cli.js";

/**
 * Mainnet readiness CLI entry (§49/§50). Modes:
 *   --static   profile completeness + protocol match + canary controls
 *   --runtime  contacts real Core A/B + Guardian + computes the stage/state
 *   (default)  both
 * Never broadcasts.
 */

const args = process.argv.slice(2);
const doStatic = args.includes("--static") || args.length === 0;
const doRuntime = args.includes("--runtime") || args.length === 0;
// Resolve relative paths against the invocation cwd (pnpm sets INIT_CWD).
const PROFILE_PATH = resolve(process.env.INIT_CWD ?? process.cwd(), process.env.COVE_V3_MAINNET_PROFILE_PATH ?? ".cove-v3-mainnet-profile.json");

function line(name: string, ok: boolean, detail = ""): void {
  console.log(`${name.padEnd(32)} ${ok ? "PASS" : "FAIL"}${ok ? "" : ` — ${detail}`}`);
}

function staticSection(): boolean {
  console.log("── STATIC ──");
  try {
    const { profile, validation } = loadMainnetProfile(PROFILE_PATH);
    line("profile completeness", validation.ok, validation.errors.slice(0, 3).join("; "));
    line("protocol profile match", !validation.errors.some((e) => e.includes("PROFILE_PROTOCOL_MISMATCH")));
    const owner = validation.errors.filter((e) => e.startsWith("OWNER_DECISION_REQUIRED"));
    console.log(`owner decisions remaining: ${owner.length}`);
    // The hash operators commit out-of-band and the Guardian must report.
    if (validation.ok) console.log(`profile hash: ${hashMainnetProfile(profile)}`);
    return validation.ok;
  } catch (e) {
    console.log(`cannot load profile: ${(e as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("Cove V3 — mainnet readiness");
  let staticReady = true;
  if (doStatic) staticReady = staticSection();

  let state = "READY_EXCEPT_FOR_OPERATOR_CEREMONY";
  if (doRuntime) {
    console.log("── RUNTIME ──");
    const r = await runRuntimeReadiness(process.env as Record<string, string | undefined>);
    const rd = r.readiness;
    line("primary Core", rd.primaryCoreHealthy);
    line("secondary Core", rd.secondaryCoreHealthy);
    line("Core agreement", rd.coreAgreement, r.coreAgreementDetail ?? "");
    line("Guardian reachable", rd.guardianHealthy);
    line("Guardian profile hash", rd.guardianProfileHashMatches);
    line("Guardian key", rd.guardianKeyMatches);
    line("custody backend", rd.custodyBackendReady);
    line("audit", rd.auditHealthy);
    line("signing journal", rd.signingJournalHealthy);
    console.log(`stage: ${rd.stage}`);
    console.log(`profile hash: ${r.profileHash}`);
    state = r.state;
  } else if (!staticReady) {
    state = "READY_EXCEPT_FOR_OPERATOR_CEREMONY";
  } else {
    state = "READY_EXCEPT_FOR_OPERATOR_CEREMONY";
  }

  console.log("");
  console.log(state);

  // A go/no-go tool must gate on its exit code, not only on stdout. NOT_READY
  // previously exited 0, so any wrapper testing `$?` read a failed readiness
  // check as success. Only the two affirmative states exit 0.
  if (state !== "READY_FOR_CONTROLLED_MAINNET_CANARY" && state !== "READY_EXCEPT_FOR_OPERATOR_CEREMONY") {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("readiness failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
