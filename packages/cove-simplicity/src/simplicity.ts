import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
 * This is the STRICT production execution path. It never falls back to a
 * TypeScript-only check and never skips: absence of the binary, a timeout, a
 * malformed result, a CMR drift, or a Bit Machine FAIL are all typed failures
 * that the Guardian treats as "no signature".
 */

/** Historical/dev CMRs (COVE_POLICY_V1/V2, preserved). */
export const MINT_CMR_V1 = "118425967f4aed4fb528bd06a0f7a99a318675e819e837a2c452df6199d359b2";
export const REDEEM_CMR_V2 = "a15ac4cbc450ac2dd113b1a9de178450ccc893a5213d8a2f56471fcd9aa274b7";
/**
 * The MINT CMR from when the public cap was 840,000,000 tokens. The cap is
 * asserted inside the predicate, so raising it to 1,000,000,000 recompiled to a
 * different commitment. Kept for reference; no live deployment used it.
 */
export const MINT_CMR_CAP840 = "0b594eb3fadec17b45bb1d245ae18f8c512a1ba42751f820cd28351ced6c8377";

/**
 * Production CMRs (COVE_POLICY_V3): the predicates now enforce the u64
 * overflow/borrow flags directly (see rust/src/mint.simf + redeem.simf). These
 * are the ONLY CMRs new deployments should use.
 */
export const MINT_CMR = "ccdb02000fdb372bfa2e166b9fe0192715d555fc5720f8008ee741fe1a0d58ec";
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

/** Typed Simplicity execution failure modes (fail-closed). */
export type SimplicityFailureCode =
  | "SIMPLICITY_BINARY_MISSING"
  | "SIMPLICITY_EXECUTION_ERROR"
  | "SIMPLICITY_TIMEOUT"
  | "SIMPLICITY_MALFORMED_RESULT"
  | "CMR_MISMATCH"
  | "SIMPLICITY_REJECTED";

export interface SimplicityExecutionResult {
  policy: "MINT" | "REDEEM";
  expectedCmr: string;
  /** CMR the compiled binary actually reported, or null if it failed first. */
  actualCmr: string | null;
  /** "PASS" only when the Bit Machine returned PASS AND actualCmr === expectedCmr. */
  result: "PASS" | "FAIL";
  /** Typed reason when result === "FAIL"; null when PASS. */
  failure: SimplicityFailureCode | null;
}

export const SIMPLICITY_TIMEOUT_MS = 10_000;

function binaryPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const release = join(here, "..", "rust", "target", "release", "cove-simplicity");
  const debug = join(here, "..", "rust", "target", "debug", "cove-simplicity");
  // Prefer the release binary; fall back to debug for local dev. The CMR check
  // below rejects any binary (release or debug) whose compiled CMR differs from
  // the frozen expectation, so a stale binary can never silently pass.
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  return null;
}

export function isSimplicityAvailable(): boolean {
  return binaryPath() !== null;
}

function mintWitnessString(w: MintWitness): string {
  return `mod witness { const AMOUNT: u64 = ${w.amount}; const PREV_SUPPLY: u64 = ${w.prevSupply}; const NEXT_SUPPLY: u64 = ${w.nextSupply}; const PREV_RESERVE: u64 = ${w.prevReserve}; const NEXT_RESERVE: u64 = ${w.nextReserve}; const CONTRIBUTION: u64 = ${w.contribution}; }`;
}

function redeemWitnessString(w: RedeemWitness): string {
  return `mod witness { const AMOUNT: u64 = ${w.amount}; const OLD_SUPPLY: u64 = ${w.oldSupply}; const NEW_SUPPLY: u64 = ${w.newSupply}; const OLD_BACKING: u64 = ${w.oldBacking}; const NEW_BACKING: u64 = ${w.newBacking}; const PAYOUT: u64 = ${w.payout}; }`;
}

interface ExecOutput {
  cmr: string;
  result: string;
}

export interface SimplicityExecOptions {
  timeoutMs?: number;
  /**
   * Override the binary path. `null` simulates an absent runtime
   * (SIMPLICITY_BINARY_MISSING); a string points the executor at a specific
   * binary (used by failure-injection tests). Default: release, then debug.
   */
  binaryPath?: string | null;
}

async function executeStrict(
  policy: "MINT" | "REDEEM",
  rustPolicy: "mint" | "redeem",
  witness: string,
  expectedCmr: string,
  opts: SimplicityExecOptions,
): Promise<SimplicityExecutionResult> {
  const base: SimplicityExecutionResult = {
    policy,
    expectedCmr,
    actualCmr: null,
    result: "FAIL",
    failure: null,
  };

  const bin = opts.binaryPath !== undefined ? opts.binaryPath : binaryPath();
  if (bin === null) {
    return { ...base, failure: "SIMPLICITY_BINARY_MISSING" };
  }

  const execFileAsync = promisify(execFile);
  let stdout: string;
  try {
    const out = await execFileAsync(bin, ["exec", rustPolicy, witness], {
      encoding: "utf8",
      maxBuffer: 1_000_000,
      timeout: opts.timeoutMs ?? SIMPLICITY_TIMEOUT_MS,
    });
    stdout = out.stdout as string;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: string;
      code?: string | number | null;
    };
    if (err.killed === true || err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
      return { ...base, failure: "SIMPLICITY_TIMEOUT" };
    }
    return { ...base, failure: "SIMPLICITY_EXECUTION_ERROR" };
  }

  let parsed: ExecOutput;
  try {
    parsed = JSON.parse(stdout) as ExecOutput;
  } catch {
    return { ...base, failure: "SIMPLICITY_MALFORMED_RESULT" };
  }
  if (typeof parsed.cmr !== "string" || typeof parsed.result !== "string") {
    return { ...base, failure: "SIMPLICITY_MALFORMED_RESULT" };
  }
  if (parsed.result !== "PASS" && parsed.result !== "FAIL") {
    return { ...base, failure: "SIMPLICITY_MALFORMED_RESULT" };
  }

  const actualCmr = parsed.cmr;
  if (actualCmr !== expectedCmr) {
    return { ...base, actualCmr, failure: "CMR_MISMATCH" };
  }
  if (parsed.result === "PASS") {
    return { ...base, actualCmr, result: "PASS", failure: null };
  }
  return { ...base, actualCmr, result: "FAIL", failure: "SIMPLICITY_REJECTED" };
}

/**
 * Execute the REAL V3 MINT Simplicity predicate. Returns PASS only when the
 * Bit Machine succeeded AND the compiled CMR exactly equals the frozen V3 CMR.
 * Never throws; every failure mode is typed and fail-closed.
 */
export function executeMintV3(
  witness: MintWitness,
  opts: SimplicityExecOptions = {},
): Promise<SimplicityExecutionResult> {
  return executeStrict("MINT", "mint", mintWitnessString(witness), MINT_CMR, opts);
}

/**
 * Execute the REAL V3 REDEEM Simplicity predicate. Same strict contract as
 * executeMintV3 (exact CMR + successful Bit Machine run required for PASS).
 */
export function executeRedeemV3(
  witness: RedeemWitness,
  opts: SimplicityExecOptions = {},
): Promise<SimplicityExecutionResult> {
  return executeStrict("REDEEM", "redeem", redeemWitnessString(witness), REDEEM_CMR, opts);
}
