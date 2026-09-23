import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Cove Simplicity pre-execution bridge (REAL Simplicity, not a TS/Rust
 * predicate). Invokes the compiled `cove-simplicity` Rust binary, which:
 *   1. compiles a frozen Cove policy (Simfony) to a real Simplicity program,
 *   2. computes the real Commitment Merkle Root (CMR),
 *   3. executes the program on the Simplicity Bit Machine against witness data.
 *
 * Results are compared against the TypeScript reference policy in the
 * differential tests — TypeScript result MUST equal the Simplicity result.
 */

/** Historical/dev CMRs (COVE_POLICY_V1/V2, preserved). */
export const MINT_CMR_V1 = "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2";
export const REDEEM_CMR_V2 = "a15ac4cbc450ac2dd113b1a9de178450ccc893a5213d8a2f56471fcd9aa274b7";

/**
 * Production CMRs (COVE_POLICY_V3): the predicates now enforce the u64
 * overflow/borrow flags directly (see rust/src/mint.simf + redeem.simf). These
 * are the ONLY CMRs new deployments should use.
 */
export const MINT_CMR = "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377";
export const REDEEM_CMR = "37e681b3e70a34acc3b38680c06fbe4f1b2799bede2607c6c9ed7fcac8c95d56";

export interface MintWitness {
  amount: bigint; // display tokens
  prevSupply: bigint; // display tokens
  nextSupply: bigint; // display tokens
  prevReserve: bigint; // sats
  nextReserve: bigint; // sats
  contribution: bigint; // sats
}

export interface RedeemWitness {
  amount: bigint; // display tokens
  oldSupply: bigint; // display tokens
  newSupply: bigint; // display tokens
  oldBacking: bigint; // sats
  newBacking: bigint; // sats
  payout: bigint; // sats
}

function binaryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const release = join(here, "..", "rust", "target", "release", "cove-simplicity");
  const debug = join(here, "..", "rust", "target", "debug", "cove-simplicity");
  if (existsSync(release)) return release;
  return debug;
}

function mintWitnessString(w: MintWitness): string {
  return `mod witness { const AMOUNT: u64 = ${w.amount}; const PREV_SUPPLY: u64 = ${w.prevSupply}; const NEXT_SUPPLY: u64 = ${w.nextSupply}; const PREV_RESERVE: u64 = ${w.prevReserve}; const NEXT_RESERVE: u64 = ${w.nextReserve}; const CONTRIBUTION: u64 = ${w.contribution}; }`;
}

function redeemWitnessString(w: RedeemWitness): string {
  return `mod witness { const AMOUNT: u64 = ${w.amount}; const OLD_SUPPLY: u64 = ${w.oldSupply}; const NEW_SUPPLY: u64 = ${w.newSupply}; const OLD_BACKING: u64 = ${w.oldBacking}; const NEW_BACKING: u64 = ${w.newBacking}; const PAYOUT: u64 = ${w.payout}; }`;
}

export function isSimplicityAvailable(): boolean {
  return existsSync(binaryPath());
}

function execute(policy: "mint" | "redeem", witness: string, expectedCmr: string): "PASS" | "FAIL" {
  const bin = binaryPath();
  const stdout = execFileSync(bin, ["exec", policy, witness], {
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });
  const parsed = JSON.parse(stdout) as { cmr: string; result: string };
  if (parsed.cmr !== expectedCmr) {
    throw new Error(`CMR drift: expected ${expectedCmr}, got ${parsed.cmr}`);
  }
  return parsed.result === "PASS" ? "PASS" : "FAIL";
}

/** Execute the Simplicity MINT predicate. Returns "PASS" | "FAIL". */
export function executeMint(witness: MintWitness): "PASS" | "FAIL" {
  return execute("mint", mintWitnessString(witness), MINT_CMR);
}

/** Execute the Simplicity REDEEM predicate. Returns "PASS" | "FAIL". */
export function executeRedeem(witness: RedeemWitness): "PASS" | "FAIL" {
  return execute("redeem", redeemWitnessString(witness), REDEEM_CMR);
}
