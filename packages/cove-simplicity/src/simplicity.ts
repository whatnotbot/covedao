import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Cove Simplicity pre-execution bridge (REAL Simplicity, not a TS/Rust
 * predicate). This module invokes the compiled `cove-simplicity` Rust binary,
 * which:
 *   1. compiles the frozen Cove MINT policy (Simfony) to a Simplicity program,
 *   2. computes the real Commitment Merkle Root (CMR),
 *   3. executes the program on the Simplicity Bit Machine against witness data.
 *
 * The result is compared against the TypeScript reference policy
 * (`validateMintTx`) in the differential test — TypeScript result MUST equal the
 * Simplicity result over generated/adversarial vectors.
 */

export const MINT_CMR = "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2";

export interface MintWitness {
  amount: bigint; // display tokens
  prevSupply: bigint; // display tokens
  nextSupply: bigint; // display tokens
  prevReserve: bigint; // sats
  nextReserve: bigint; // sats
  contribution: bigint; // sats
}

function binaryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const release = join(here, "..", "rust", "target", "release", "cove-simplicity");
  const debug = join(here, "..", "rust", "target", "debug", "cove-simplicity");
  if (existsSync(release)) return release;
  return debug;
}

function witnessString(w: MintWitness): string {
  return `mod witness { const AMOUNT: u64 = ${w.amount}; const PREV_SUPPLY: u64 = ${w.prevSupply}; const NEXT_SUPPLY: u64 = ${w.nextSupply}; const PREV_RESERVE: u64 = ${w.prevReserve}; const NEXT_RESERVE: u64 = ${w.nextReserve}; const CONTRIBUTION: u64 = ${w.contribution}; }`;
}

export function isSimplicityAvailable(): boolean {
  return existsSync(binaryPath());
}

/** Execute the Simplicity MINT predicate. Returns "PASS" | "FAIL". */
export function executeMint(witness: MintWitness): "PASS" | "FAIL" {
  const bin = binaryPath();
  const stdout = execFileSync(bin, ["exec", witnessString(witness)], {
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  const parsed = JSON.parse(stdout) as { cmr: string; result: string };
  if (parsed.cmr !== MINT_CMR) {
    throw new Error(`CMR drift: expected ${MINT_CMR}, got ${parsed.cmr}`);
  }
  return parsed.result === "PASS" ? "PASS" : "FAIL";
}
