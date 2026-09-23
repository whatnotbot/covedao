import type { CoveState } from "@crclaunch/protocol";

/** A proof step (deploy/mint/transfer). height=0 means "broadcast, unconfirmed". */
export interface ProofStep {
  txid: string;
  height: number;
  blockHash: string;
  stateRoot: string;
}

/**
 * Public, gitignored, WIF-free proof manifest. Persists ONLY public state so a
 * re-run resumes instead of re-broadcasting. Never contains WIFs/seeds/keys.
 */
export interface ProofManifest {
  protocol: "cove";
  network: "signet";
  ticker: string;
  signerA: string;
  signerB: string;
  deploy?: ProofStep;
  mint?: ProofStep;
  transfer?: ProofStep;
}

export type ProofAction = "DEPLOY" | "MINT" | "TRANSFER" | "DONE";

export interface ProofDecision {
  action: ProofAction;
  reason?: string;
}

const TICK_RE = /^[A-Z0-9]{4}$/;

export function validateTicker(t: string): string {
  const v = (t ?? "").trim().toUpperCase();
  if (!TICK_RE.test(v)) throw new Error(`COVE_PROOF_TICKER must match [A-Z0-9]{4}, got "${t}"`);
  return v;
}

/**
 * Pure resume decision. Given the canonical state and the persisted manifest,
 * decide the next proof action. Uses the manifest txids to avoid ever
 * re-broadcasting a step that was already constructed.
 */
export function decideNextAction(
  manifest: ProofManifest,
  state: CoveState,
  actorScript: string,
  recipientScript: string,
  mintAmountAtoms: bigint,
  transferAmountAtoms: bigint,
): ProofDecision {
  const dep = state.tickerIndex.get(manifest.ticker);

  if (dep === undefined) {
    // No deployment indexed yet. If we already recorded a deploy txid, do not
    // blindly redeploy — the caller must first resolve its mempool/chain status.
    if (manifest.deploy?.txid) {
      return { action: "DEPLOY", reason: "deploy recorded but not yet confirmed; resolve before re-broadcast" };
    }
    return { action: "DEPLOY" };
  }

  // Ticker owned by an unrelated deployment (a different txid than ours).
  if (manifest.deploy?.txid && manifest.deploy.txid !== dep) {
    throw new Error(`ticker ${manifest.ticker} is owned by unrelated deployment ${dep}`);
  }

  const aBal = state.balances.get(actorScript)?.get(dep)?.availableAtoms ?? 0n;
  const bBal = state.balances.get(recipientScript)?.get(dep)?.availableAtoms ?? 0n;
  const token = state.tokens.get(dep)!;

  // Deploy complete. Has the mint happened? (supply, not A's balance, survives transfer)
  const mintDone = token.confirmedSupplyAtoms >= mintAmountAtoms;
  if (!mintDone) {
    return manifest.mint?.txid ? { action: "MINT", reason: "mint recorded but not yet confirmed" } : { action: "MINT" };
  }

  // Mint complete. Has the transfer happened?
  if (aBal === mintAmountAtoms - transferAmountAtoms && bBal === transferAmountAtoms) {
    return { action: "DONE" };
  }
  return manifest.transfer?.txid ? { action: "TRANSFER", reason: "transfer recorded but not yet confirmed" } : { action: "TRANSFER" };
}
