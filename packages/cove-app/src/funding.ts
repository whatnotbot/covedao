import type { CoreRpcProvider } from "@crclaunch/bitcoin";
import { AppError } from "./errors.js";

/**
 * Funding resolution (§18/§73). Browser submits only (txid, vout); the server
 * resolves actual script + value via Core (authoritative unspent check) and
 * matches the script to the connected wallet's payment script. Browser-supplied
 * value/script are never trusted.
 */

export interface FundingCandidate {
  txid: string;
  vout: number;
}

export interface ResolvedFunding {
  txid: string;
  vout: number;
  script: Buffer;
  valueSats: bigint;
  /** 0 while in the mempool. */
  confirmations: number;
}

export async function resolveFundingUtxo(provider: CoreRpcProvider, c: FundingCandidate): Promise<ResolvedFunding> {
  const txout = await provider.getTxout(c.txid, c.vout);
  if (!txout) throw new AppError("FUNDING_INPUT_SPENT", `input ${c.txid}:${c.vout} is spent or unknown`);
  return {
    txid: c.txid,
    vout: c.vout,
    script: Buffer.from(txout.scriptPubKeyHex, "hex"),
    valueSats: txout.valueSats,
    confirmations: txout.confirmations,
  };
}

export async function resolveFundingUtxos(provider: CoreRpcProvider, candidates: FundingCandidate[]): Promise<ResolvedFunding[]> {
  return Promise.all(candidates.map((c) => resolveFundingUtxo(provider, c)));
}

/** Deterministic funding selection: fewest-inputs-first (largest first), ties by txid/vout. */
export function selectFunding(utxos: ResolvedFunding[], requiredSats: bigint): ResolvedFunding[] {
  const sorted = [...utxos].sort((a, b) => {
    if (a.valueSats !== b.valueSats) return a.valueSats > b.valueSats ? -1 : 1;
    if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
    return a.vout - b.vout;
  });
  const selected: ResolvedFunding[] = [];
  let sum = 0n;
  for (const u of sorted) {
    selected.push(u);
    sum += u.valueSats;
    if (sum >= requiredSats) return selected;
  }
  throw new AppError("INSUFFICIENT_BTC", `wallet has ${sum} sats but ${requiredSats} required`);
}
