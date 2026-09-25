import * as bitcoin from "bitcoinjs-lib";
// Imported, never assumed. `Buffer` is NOT a browser global, and this module
// runs in a browser — reaching for the global here failed silently and took the
// whole envelope check down with it.
import { Buffer } from "buffer";
import {
  decodeV2,
  COVE_WIRE_MAGIC,
  OP_DEPLOY,
  OP_MINT,
  OP_REDEEM,
  OP_TRANSFER,
} from "@crclaunch/cove-wire/codec-v2";

/**
 * Client-side transaction-intent verification (§23/§M3). The user must never be
 * asked to sign a PSBT the server returned without independently re-checking it
 * against the human-readable intent. This module is ECC-free and browser-safe
 * (it only parses + hashes; signing lives in e2e-signer.ts for the test harness).
 *
 * §M3: the digest alone is NOT proof — it is a value the same server supplied
 * (circular). Every economically-relevant fact is re-derived from the user's
 * own numbers and asserted against the PSBT:
 *
 *   1. the miner fee,
 *   2. the net BTC the wallet gains or loses, re-derived from the price, the
 *      protocol fee and the miner fee the user was shown,
 *   3. the token amount and its recipient, read out of the Cove OP_RETURN that
 *      the indexer will later read — not out of anything the server says.
 *
 * (3) is what makes (2) meaningful. Without it a server could charge the quoted
 * price and mint one token instead of a million: every satoshi check would pass
 * and the buyer would still be robbed.
 */

export interface ClientIntent {
  operation: string;
  tokenId: string | null;
  tokenAmountAtoms: string | null;
  grossSats: string | null;
  protocolFeeSats: string | null;
  minerFeeSats: string;
  netSats: string | null;
  walletScript: string;
  stateHash: string | null;
  unsignedTxDigest: string;
  /**
   * Net satoshis the wallet gains (positive) or loses (negative) across this
   * transaction. This is the single number a user actually cares about, so it
   * is stated explicitly and checked rather than left implicit in the outputs.
   */
  walletDeltaSats?: string | null;
  /**
   * Which way the tokens move for THIS wallet. A peer-to-peer fill is one
   * transaction seen from two sides: the buyer must be shown that the tokens
   * arrive, the seller that they leave. Getting this backwards would check the
   * wrong half and pass.
   *
   * Inferred from the operation when omitted; an operation with no known
   * direction is refused rather than guessed at.
   */
  tokenDirection?: "in" | "out";
}

/** Which way tokens move for the signing wallet, per operation. */
const TOKEN_DIRECTION: Record<string, "in" | "out"> = {
  BACKING_BUY: "in",
  P2P_BUY: "in",
  REDEEM: "out",
  TRANSFER: "out",
  P2P_SELL: "out",
};

export function unsignedTxDigestHex(psbt: bitcoin.Psbt): string {
  return bitcoin.crypto.sha256(psbt.data.globalMap.unsignedTx.toBuffer()).toString("hex");
}

export interface VerifiedIntent {
  ok: true;
  digest: string;
  inputCount: number;
  outputCount: number;
  totalInputSats: bigint;
  totalOutputSats: bigint;
  /** Net satoshis into (+) or out of (−) the wallet, as measured from the PSBT. */
  walletDeltaSats: bigint;
}

function bigintOr(s: string | null | undefined): bigint | null {
  if (s === null || s === undefined) return null;
  return BigInt(s);
}

function mismatch(detail: string): never {
  throw new Error(`CLIENT_INTENT_MISMATCH: ${detail}`);
}

/**
 * The Cove OP_RETURN, decoded from the transaction itself.
 *
 * An output is a CANDIDATE only if its payload carries the Cove magic — the
 * advisory crc-20 discovery envelope is JSON and never does. Once a candidate
 * is found it is decoded WITHOUT a catch: a Cove-magic payload that will not
 * parse is a refusal, not something to skip past. Swallowing decode failures
 * here is precisely how an unchecked transaction reaches a signature.
 */
function coveEnvelope(psbt: bitcoin.Psbt) {
  for (const out of psbt.txOutputs) {
    // OP_RETURN <push len> <payload>; only direct pushes below 0x4c are used.
    if (out.script.length < 6 || out.script[0] !== 0x6a) continue;
    const len = out.script[1]!;
    if (len >= 0x4c || out.script.length !== 2 + len) continue;
    if (((out.script[2]! << 8) | out.script[3]!) !== COVE_WIRE_MAGIC) continue;
    try {
      return decodeV2(Buffer.from(out.script.subarray(2)));
    } catch (e) {
      mismatch(`the Cove envelope in this transaction is unreadable: ${(e as Error).message}`);
    }
  }
  return null;
}

/** Throws CLIENT_INTENT_MISMATCH when the PSBT diverges from the server intent. */
export function verifyClientIntent(
  psbtBase64: string,
  intent: ClientIntent,
  network: bitcoin.networks.Network = bitcoin.networks.regtest,
): VerifiedIntent {
  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  } catch {
    mismatch("cannot parse PSBT");
  }

  // Structural integrity: the unsigned tx must byte-match the digest. This alone
  // cannot detect a hostile backend, so the checks below are the real gate.
  const digest = unsignedTxDigestHex(psbt);
  if (digest !== intent.unsignedTxDigest) mismatch("unsigned transaction changed");

  const totalInputSats = psbt.data.inputs.reduce((s, i) => s + BigInt(i.witnessUtxo?.value ?? 0), 0n);
  const totalOutputSats = psbt.txOutputs.reduce((s, o) => s + BigInt(o.value), 0n);

  // Miner fee exactness: the fee the user was shown must be the actual fee.
  const minerFee = totalInputSats - totalOutputSats;
  const expectedMinerFee = BigInt(intent.minerFeeSats);
  if (minerFee !== expectedMinerFee) {
    mismatch(`miner fee ${minerFee} != expected ${expectedMinerFee}`);
  }

  const outputs = psbt.txOutputs.map((o, i) => ({
    index: i,
    scriptHex: o.script.toString("hex"),
    value: BigInt(o.value),
  }));

  // ── what this transaction does to the wallet's balance ───────────────────
  const walletIn = psbt.data.inputs.reduce(
    (s, i) =>
      i.witnessUtxo?.script.toString("hex") === intent.walletScript
        ? s + BigInt(i.witnessUtxo.value)
        : s,
    0n,
  );
  const walletOut = outputs.reduce(
    (s, o) => (o.scriptHex === intent.walletScript ? s + o.value : s),
    0n,
  );
  const walletDeltaSats = walletOut - walletIn;

  const statedDelta = bigintOr(intent.walletDeltaSats);
  if (statedDelta !== null && statedDelta !== walletDeltaSats) {
    mismatch(`wallet balance changes by ${walletDeltaSats} sats, not the stated ${statedDelta}`);
  }

  const gross = bigintOr(intent.grossSats);
  const protocolFee = bigintOr(intent.protocolFeeSats);
  const net = bigintOr(intent.netSats);

  // Protocol fee: the quoted fee amount must appear as an output.
  if (protocolFee !== null && protocolFee > 0n && !outputs.some((o) => o.value === protocolFee)) {
    mismatch("protocol fee output missing");
  }

  // Re-derive the balance change from the numbers the user read, per operation.
  // These identities hold by construction of each builder, so a failure means
  // the transaction is not the one that was described.
  if (intent.operation === "BACKING_BUY") {
    if (gross === null || protocolFee === null) mismatch("buy intent is missing its price");
    const expected = -(gross + protocolFee + expectedMinerFee);
    if (walletDeltaSats !== expected) {
      mismatch(
        `buying costs ${-walletDeltaSats} sats, not the ${-expected} you were shown ` +
          `(${gross} price + ${protocolFee} protocol fee + ${expectedMinerFee} miner fee)`,
      );
    }
  } else if (intent.operation === "REDEEM") {
    if (net === null) mismatch("redeem intent is missing its payout");
    const expected = net - expectedMinerFee;
    if (walletDeltaSats !== expected) {
      mismatch(
        `redeeming pays ${walletDeltaSats} sats, not the ${expected} you were shown ` +
          `(${net} payout less ${expectedMinerFee} miner fee)`,
      );
    }
  }

  // A stated payout must land on the wallet's own script, at exactly that
  // value, whatever the operation. This is what a peer-to-peer seller relies
  // on: the price they agreed to, paid to them and not to anyone else.
  if (net !== null) {
    if (!outputs.some((o) => o.scriptHex === intent.walletScript && o.value === net)) {
      mismatch(`no ${net}-sat payout to your wallet`);
    }
  } else if (!outputs.some((o) => o.scriptHex === intent.walletScript)) {
    mismatch("no output to the wallet");
  }

  // ── the token side ────────────────────────────────────────────────────────
  verifyTokenEnvelope(psbt, intent, outputs);

  return {
    ok: true,
    digest,
    inputCount: psbt.data.inputs.length,
    outputCount: psbt.txOutputs.length,
    totalInputSats,
    totalOutputSats,
    walletDeltaSats,
  };
}

/**
 * The Cove envelope is the only thing that moves tokens. BTC arithmetic proves
 * the user pays the right amount; this proves they get what they paid for.
 */
function verifyTokenEnvelope(
  psbt: bitcoin.Psbt,
  intent: ClientIntent,
  outputs: { index: number; scriptHex: string; value: bigint }[],
): void {
  const envelope = coveEnvelope(psbt);
  const amount = bigintOr(intent.tokenAmountAtoms);

  if (envelope === null) {
    // Only a transaction that claims to move no tokens may lack an envelope.
    if (amount !== null && amount > 0n) mismatch("no Cove envelope in this transaction");
    return;
  }

  if (envelope.op !== OP_DEPLOY && intent.tokenId) {
    if (envelope.tokenId.toString("hex") !== intent.tokenId) {
      mismatch(
        `this transaction moves token ${envelope.tokenId.toString("hex").slice(0, 16)}…, ` +
          `not ${intent.tokenId.slice(0, 16)}…`,
      );
    }
  }

  switch (envelope.op) {
    case OP_MINT: {
      if (amount === null) mismatch("buy intent is missing its token amount");
      if (envelope.amount !== amount) {
        mismatch(`this transaction mints ${envelope.amount} atoms, not the ${amount} you asked for`);
      }
      // The freshly minted tokens must land on the buyer's own script.
      const recipient = outputs[envelope.recipientVout];
      if (!recipient || recipient.scriptHex !== intent.walletScript) {
        mismatch(`the minted tokens go to output ${envelope.recipientVout}, which is not your wallet`);
      }
      break;
    }
    case OP_REDEEM: {
      if (amount === null) mismatch("redeem intent is missing its token amount");
      if (envelope.redeemAmount !== amount) {
        mismatch(
          `this transaction redeems ${envelope.redeemAmount} atoms, not the ${amount} you asked for`,
        );
      }
      // Any token change must come back to the seller, not to a stranger.
      for (const alloc of envelope.changeAllocations) {
        const out = outputs[alloc.vout];
        if (!out || out.scriptHex !== intent.walletScript) {
          mismatch(`token change at output ${alloc.vout} does not return to your wallet`);
        }
      }
      break;
    }
    case OP_TRANSFER: {
      if (amount === null) mismatch("transfer intent is missing its token amount");
      const direction = intent.tokenDirection ?? TOKEN_DIRECTION[intent.operation];
      if (direction === undefined) {
        mismatch(`cannot tell which way tokens move for operation ${intent.operation}`);
      }
      // Allocations landing on the wallet's own script are what it receives;
      // everything else leaves. Which of the two must equal the stated amount
      // depends on whether this wallet is the sender or the recipient.
      let arriving = 0n;
      let leaving = 0n;
      for (const alloc of envelope.allocations) {
        if (outputs[alloc.vout]?.scriptHex === intent.walletScript) arriving += alloc.amount;
        else leaving += alloc.amount;
      }
      if (direction === "in" && arriving !== amount) {
        mismatch(`this transaction delivers ${arriving} atoms to you, not the ${amount} agreed`);
      }
      if (direction === "out" && leaving !== amount) {
        mismatch(`this transaction sends ${leaving} atoms away, not the ${amount} you entered`);
      }
      break;
    }
    case OP_DEPLOY:
      // A deploy moves no tokens; there is nothing to mis-deliver.
      break;
    default:
      // An operation this build does not understand is a refusal, never a
      // pass. Falling through silently here is exactly how an unchecked
      // transaction gets signed.
      mismatch(`unrecognised Cove operation ${String((envelope as { op: unknown }).op)}`);
  }
}
