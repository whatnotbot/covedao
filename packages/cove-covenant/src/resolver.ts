import type { CoveStateV2 } from "./stateV2.js";

/**
 * Minimal deterministic in-memory Cove chain view (§4). Resolves Cove token
 * inputs from ACTUAL transaction input outpoints (never from caller-supplied
 * claims) and maintains the unspent token-UTXO set + backing state. This is
 * test infrastructure for the real lifecycle and can later feed the DB indexer.
 */

export interface OutPoint {
  txid: string;
  vout: number;
}

export interface TokenUtxo {
  outpoint: OutPoint;
  tokenId: Buffer;
  amountAtoms: bigint;
  scriptPubKey: Buffer;
}

export interface TokenMeta {
  tokenId: Buffer;
  ticker: string;
  policyVersion: number;
  deployTxid: string;
  tokenNonce: Buffer;
}

export interface BackingView {
  state: CoveStateV2;
  outpoint: OutPoint;
}

function opKey(o: OutPoint): string {
  return `${o.txid}:${o.vout}`;
}

export class CoveChainView {
  readonly tokens = new Map<string, TokenMeta>();
  readonly tokenUtxos = new Map<string, TokenUtxo>();
  readonly backing = new Map<string, BackingView>();

  deploy(meta: TokenMeta, backingOutpoint: OutPoint, s0: CoveStateV2): void {
    const key = meta.tokenId.toString("hex");
    if (this.tokens.has(key)) throw new Error("duplicate tokenId deploy");
    this.tokens.set(key, meta);
    this.backing.set(key, { state: s0, outpoint: backingOutpoint });
  }

  /** Mint: record successor backing + buyer token carrier output. */
  mint(params: {
    tokenId: Buffer;
    nextState: CoveStateV2;
    prevBackingOutpoint: OutPoint;
    nextBackingOutpoint: OutPoint;
    recipientOutpoint: OutPoint;
    recipientScript: Buffer;
    amountAtoms: bigint;
  }): void {
    const key = params.tokenId.toString("hex");
    if (!this.tokens.has(key)) throw new Error("token not found");
    const b = this.backing.get(key)!;
    if (opKey(b.outpoint) !== opKey(params.prevBackingOutpoint))
      throw new Error("stale backing outpoint");
    this.backing.set(key, { state: params.nextState, outpoint: params.nextBackingOutpoint });
    this.tokenUtxos.set(opKey(params.recipientOutpoint), {
      outpoint: params.recipientOutpoint,
      tokenId: params.tokenId,
      amountAtoms: params.amountAtoms,
      scriptPubKey: params.recipientScript,
    });
  }

  /** Transfer: spend token inputs, create allocated outputs (recipient + change). */
  transfer(params: {
    tokenId: Buffer;
    spentOutpoints: OutPoint[];
    created: { outpoint: OutPoint; script: Buffer; amountAtoms: bigint }[];
  }): void {
    const key = params.tokenId.toString("hex");
    if (!this.tokens.has(key)) throw new Error("token not found");
    for (const o of params.spentOutpoints) {
      const u = this.tokenUtxos.get(opKey(o));
      if (!u) throw new Error(`token input ${opKey(o)} not in canonical set`);
      if (!u.tokenId.equals(params.tokenId)) throw new Error("mixed token input");
      this.tokenUtxos.delete(opKey(o));
    }
    for (const c of params.created) {
      this.tokenUtxos.set(opKey(c.outpoint), {
        outpoint: c.outpoint,
        tokenId: params.tokenId,
        amountAtoms: c.amountAtoms,
        scriptPubKey: c.script,
      });
    }
  }

  /** Redeem: spend token input(s) + backing; record successor backing + change. */
  redeem(params: {
    tokenId: Buffer;
    nextState: CoveStateV2;
    prevBackingOutpoint: OutPoint;
    nextBackingOutpoint: OutPoint;
    spentTokenOutpoints: OutPoint[];
    change: { outpoint: OutPoint; script: Buffer; amountAtoms: bigint }[];
  }): void {
    const key = params.tokenId.toString("hex");
    if (!this.tokens.has(key)) throw new Error("token not found");
    const b = this.backing.get(key)!;
    if (opKey(b.outpoint) !== opKey(params.prevBackingOutpoint))
      throw new Error("stale backing outpoint");
    this.backing.set(key, { state: params.nextState, outpoint: params.nextBackingOutpoint });
    for (const o of params.spentTokenOutpoints) {
      const u = this.tokenUtxos.get(opKey(o));
      if (!u) throw new Error(`token input ${opKey(o)} not in canonical set`);
      if (!u.tokenId.equals(params.tokenId)) throw new Error("mixed token input");
      this.tokenUtxos.delete(opKey(o));
    }
    for (const c of params.change) {
      this.tokenUtxos.set(opKey(c.outpoint), {
        outpoint: c.outpoint,
        tokenId: params.tokenId,
        amountAtoms: c.amountAtoms,
        scriptPubKey: c.script,
      });
    }
  }

  /** Resolve the Cove token inputs actually referenced by a transaction's inputs. */
  resolveTokenInputs(ins: { txid: string; vout: number }[]): TokenUtxo[] {
    const out: TokenUtxo[] = [];
    for (const i of ins) {
      const u = this.tokenUtxos.get(opKey(i));
      if (u) out.push(u);
    }
    return out;
  }

  /** Aggregate spendable balance (derived; not authoritative). */
  balanceOf(tokenId: Buffer): bigint {
    let total = 0n;
    for (const u of this.tokenUtxos.values()) {
      if (u.tokenId.equals(tokenId)) total += u.amountAtoms;
    }
    return total;
  }
}
