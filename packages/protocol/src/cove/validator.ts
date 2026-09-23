import {
  PUBLIC_SUPPLY_ATOMS,
  computePlatformFee,
  getStageForSupply,
  quoteExactTokens,
} from "@crclaunch/curve";
import type { Sats } from "@crclaunch/curve";
import type { CoveState, CoveTransaction, CoveToken, CoveValidationResult } from "./types.js";

export interface CoveConfig {
  /** scriptPubKey hex of the canonical treasury (platform fees + launch fee). */
  treasuryScript: string;
  /** scriptPubKey hex of the canonical protocol reserve (curve payments). */
  reserveScript: string;
  launchFeeSats: Sats;
  primaryMintFeeBps: bigint;
  /** Supported recipient/sender script types (P2WPKH / P2TR). */
  supportedScriptPrefixes: readonly string[];
}

function validateRecipientScript(scriptHex: string): boolean {
  // P2WPKH = 0014<20> (44 hex), P2TR = 5120<32> (68 hex).
  return (
    (scriptHex.startsWith("0014") && scriptHex.length === 44) ||
    (scriptHex.startsWith("5120") && scriptHex.length === 68)
  );
}

function isSupportedScript(scriptHex: string, cfg: CoveConfig): boolean {
  return cfg.supportedScriptPrefixes.some((p) => scriptHex.startsWith(p));
}

/** Resolve the token a ticker references (MINT/TRANSFER); undefined if unknown. */
function resolveToken(state: CoveState, ticker?: string): CoveToken | undefined {
  if (!ticker) return undefined;
  const deploymentId = state.tickerIndex.get(ticker);
  return deploymentId ? state.tokens.get(deploymentId) : undefined;
}

/**
 * Shared deterministic Cove validator (DEPLOY/MINT/TRANSFER). Economics are
 * recomputed from the canonical curve; only Bitcoin-proven facts (actor,
 * recipient, outputs, ordering) arrive via CoveTransaction.
 */
export function validateCoveOperation(
  state: CoveState,
  tx: CoveTransaction,
  cfg: CoveConfig,
): CoveValidationResult {
  switch (tx.operation) {
    case "DEPLOY":
      return validateDeploy(state, tx, cfg);
    case "MINT":
      return validateMint(state, tx, cfg);
    case "TRANSFER":
      return validateTransfer(state, tx, cfg);
    default:
      return { valid: false, reason: "UNSUPPORTED_OPERATION" };
  }
}

function validateDeploy(
  state: CoveState,
  tx: CoveTransaction,
  cfg: CoveConfig,
): CoveValidationResult {
  const tick = tx.ticker ?? "";
  if (!/^[A-Z0-9]{4}$/.test(tick)) return { valid: false, reason: "INVALID_TICKER" };
  if (state.tickerIndex.has(tick)) return { valid: false, reason: "TICKER_TAKEN" };
  if (!isSupportedScript(tx.actor, cfg))
    return { valid: false, reason: "UNSUPPORTED_ACTOR_SCRIPT" };

  // vout 1 must be the exact launch fee to the canonical treasury.
  const feeOut = tx.protocolOutputs.find((o) => o.role === "launch-fee");
  if (!feeOut || feeOut.index !== 1) return { valid: false, reason: "INVALID_OUTPUT_LAYOUT" };
  if (feeOut.scriptPubKeyHex !== cfg.treasuryScript)
    return { valid: false, reason: "WRONG_TREASURY" };
  if (feeOut.amountSats !== cfg.launchFeeSats) {
    return {
      valid: false,
      reason: feeOut.amountSats < cfg.launchFeeSats ? "UNDERPAYMENT" : "OVERPAYMENT",
    };
  }
  return { valid: true, reason: null };
}

function validateMint(
  state: CoveState,
  tx: CoveTransaction,
  cfg: CoveConfig,
): CoveValidationResult {
  const token = resolveToken(state, tx.ticker);
  if (!token) return { valid: false, reason: "UNKNOWN_DEPLOYMENT" };
  if (tx.supplyBefore === undefined) return { valid: false, reason: "MISSING_SUPPLY" };
  if (tx.supplyBefore !== token.confirmedSupply) {
    return { valid: false, reason: "STALE_SUPPLY" };
  }
  const amount = tx.tokenAmount ?? 0n;
  if (amount <= 0n) return { valid: false, reason: "ZERO_AMOUNT" };
  if (!isSupportedScript(tx.actor, cfg))
    return { valid: false, reason: "UNSUPPORTED_ACTOR_SCRIPT" };
  if (!tx.recipient || !validateRecipientScript(tx.recipient)) {
    return { valid: false, reason: "INVALID_RECIPIENT" };
  }

  const remainingTokens = token.publicSupply - token.confirmedSupply;
  if (amount > remainingTokens) return { valid: false, reason: "OVERMINT" };

  // Independently recompute curve economics (never trust payload).
  const quote = quoteExactTokens({
    desiredTokens: amount,
    currentSupply: token.confirmedSupply,
  });
  const requiredCurve = quote.curveContributionSats;
  const requiredPlatform = computePlatformFee(requiredCurve, cfg.primaryMintFeeBps);

  const curveOut = tx.protocolOutputs.find((o) => o.role === "curve");
  if (!curveOut || curveOut.index !== 2) return { valid: false, reason: "INVALID_OUTPUT_LAYOUT" };
  if (curveOut.scriptPubKeyHex !== cfg.reserveScript)
    return { valid: false, reason: "WRONG_RESERVE" };
  if (curveOut.amountSats !== requiredCurve) {
    return {
      valid: false,
      reason: curveOut.amountSats < requiredCurve ? "UNDERPAYMENT" : "OVERPAYMENT",
    };
  }

  const feeOut = tx.protocolOutputs.find((o) => o.role === "platform-fee");
  if (!feeOut || feeOut.index !== 3) return { valid: false, reason: "INVALID_OUTPUT_LAYOUT" };
  if (feeOut.scriptPubKeyHex !== cfg.treasuryScript)
    return { valid: false, reason: "WRONG_TREASURY" };
  if (feeOut.amountSats !== requiredPlatform) {
    return {
      valid: false,
      reason: feeOut.amountSats < requiredPlatform ? "UNDERPAYMENT" : "OVERPAYMENT",
    };
  }

  return { valid: true, reason: null };
}

function validateTransfer(
  state: CoveState,
  tx: CoveTransaction,
  cfg: CoveConfig,
): CoveValidationResult {
  const token = resolveToken(state, tx.ticker);
  if (!token) return { valid: false, reason: "UNKNOWN_DEPLOYMENT" };
  const amount = tx.tokenAmount ?? 0n;
  if (amount <= 0n) return { valid: false, reason: "ZERO_AMOUNT" };
  if (!isSupportedScript(tx.actor, cfg))
    return { valid: false, reason: "UNSUPPORTED_ACTOR_SCRIPT" };
  if (!tx.recipient || !validateRecipientScript(tx.recipient)) {
    return { valid: false, reason: "INVALID_RECIPIENT" };
  }
  if (tx.recipient === tx.actor) return { valid: false, reason: "SELF_TRANSFER" };

  const senderBal = state.balances.get(tx.actor)?.get(token.deploymentId);
  const available = senderBal ? senderBal.available - senderBal.locked : 0n;
  if (available < amount) return { valid: false, reason: "INSUFFICIENT_AVAILABLE_TOKENS" };

  return { valid: true, reason: null };
}

/** Apply a VALIDATED operation (pure state transition). */
export function applyCoveOperation(state: CoveState, tx: CoveTransaction, cfg: CoveConfig): void {
  switch (tx.operation) {
    case "DEPLOY": {
      const tick = tx.ticker!;
      const token: CoveToken = {
        deploymentId: tx.txid,
        ticker: tick,
        creator: tx.actor,
        confirmedSupply: 0n,
        publicSupply: PUBLIC_SUPPLY_ATOMS,
        currentStage: 1,
      };
      state.tokens.set(tx.txid, token);
      state.tickerIndex.set(tick, tx.txid);
      state.platformTreasurySats += cfg.launchFeeSats;
      return;
    }
    case "MINT": {
      const token = resolveToken(state, tx.ticker)!;
      const amount = tx.tokenAmount!;
      const quote = quoteExactTokens({
        desiredTokens: amount,
        currentSupply: token.confirmedSupply,
      });
      const requiredCurve = quote.curveContributionSats;
      const requiredPlatform = computePlatformFee(requiredCurve, cfg.primaryMintFeeBps);

      token.confirmedSupply += amount;
      token.currentStage = getStageForSupply(token.confirmedSupply);
      state.reserveSats += requiredCurve;
      state.platformTreasurySats += requiredPlatform;

      let bal = state.balances.get(tx.recipient!);
      if (!bal) {
        bal = new Map();
        state.balances.set(tx.recipient!, bal);
      }
      const cur = bal.get(token.deploymentId) ?? { available: 0n, locked: 0n };
      bal.set(token.deploymentId, { available: cur.available + amount, locked: cur.locked });
      return;
    }
    case "TRANSFER": {
      const token = resolveToken(state, tx.ticker)!;
      const amount = tx.tokenAmount!;
      const sender = state.balances.get(tx.actor)!.get(token.deploymentId)!;
      sender.available -= amount;

      let recv = state.balances.get(tx.recipient!);
      if (!recv) {
        recv = new Map();
        state.balances.set(tx.recipient!, recv);
      }
      const cur = recv.get(token.deploymentId) ?? { available: 0n, locked: 0n };
      recv.set(token.deploymentId, { available: cur.available + amount, locked: cur.locked });
      return;
    }
  }
}
