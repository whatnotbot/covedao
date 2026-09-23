import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import type { ChainUtxo } from "./provider.js";
import { btcNetwork, opReturnPayload, type NetworkName } from "./decoder.js";
import { dustThreshold, isP2TR, isP2WPKH } from "./dust.js";

// Taproot address/script derivation requires an ECC library. Init once at
// module load so P2TR change/output addresses work end-to-end.
bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

/** A protocol output is exactly one of a raw script or a network address. */
export type TxOutput =
  | { readonly script: Uint8Array; readonly valueSats: bigint; readonly address?: never }
  | { readonly address: string; readonly valueSats: bigint; readonly script?: never };

export interface CovePsbt {
  psbtBase64: string;
  /** Unsigned raw transaction hex (pre-signature), for validation/display. */
  unsignedHex: string;
  opReturnHex: string;
  /** Actual miner fee = totalIn − Σ(actual outputs), never an estimate. */
  feeSats: bigint;
  /** Actual change output value, or 0n when no change output was added. */
  changeSats: bigint;
}

/** Build an OP_RETURN script carrying a single UTF-8 JSON push. */
export function opReturnScript(json: string): Buffer {
  return bitcoin.script.compile([0x6a, Buffer.from(json, "utf8")]);
}

/** Build an OP_RETURN script carrying an arbitrary payload push. */
export function opReturnScriptData(data: Uint8Array): Buffer {
  return bitcoin.script.compile([0x6a, Buffer.from(data)]);
}

export interface BuildTxParams {
  network: NetworkName;
  inputs: ChainUtxo[];
  outputs: TxOutput[];
  changeAddress: string;
  feeRateSatVb: bigint;
  /** Required ceiling (sat/vB) — a safety gate, not optional. */
  maxFeeRateSatVb: bigint;
  /** Required ceiling (sats) on the total miner fee. */
  maxMinerFeeSats: bigint;
}

const MAX_MONEY_SATS = 2_100_000_000_000_000n; // 21M BTC
const MAX_OP_RETURN_PAYLOAD = 80; // Bitcoin Core datacarrier standardness (relay policy)

/**
 * Conservative signed-input vbyte estimate per script type.
 * Non-witness input base is 41 vbytes (outpoint 36 + empty scriptSig 1 +
 * sequence 4); witness adds ceil(witnessBytes/4):
 *   P2WPKH witness ≈ 108 bytes → +27  ⇒ 68
 *   P2TR   witness ≈ 66 bytes  → +17  ⇒ 58
 */
export function estimateInputVsize(scriptPubKeyHex: string): number {
  const script = Buffer.from(scriptPubKeyHex, "hex");
  if (isP2TR(script)) return 58;
  if (isP2WPKH(script)) return 68;
  return 148; // legacy (will be rejected below unless nonWitnessUtxo is wired)
}

/** Serialized output size: 8 (value) + 1 (script-len varint, len<253) + len. */
export function estimateOutputVsize(script: Uint8Array): number {
  return 8 + 1 + script.length;
}

/** Resolve an output's script from address or raw script (validates network). */
function resolveOutputScript(out: TxOutput, net: bitcoin.networks.Network): Buffer {
  if (out.script) return Buffer.from(out.script);
  if (out.address) return bitcoin.address.toOutputScript(out.address, net);
  // Unreachable with the discriminated union unless cast; guard anyway.
  throw new Error("Output has neither address nor script.");
}

/**
 * Build an unsigned PSBT from inputs + explicit protocol outputs + a change
 * output. Script-aware conservative vsize; rejects duplicate outpoints, zero
 * inputs, zero/over-cap fee rates, out-of-range values, wrong-network change
 * addresses, non-signable legacy inputs, and non-relayable OP_RETURN layouts.
 * No private keys are held here.
 */
export function buildUnsignedPsbt(params: BuildTxParams): CovePsbt {
  const net = btcNetwork(params.network);
  if (params.inputs.length === 0) throw new Error("No inputs provided.");
  if (params.feeRateSatVb <= 0n) throw new Error("Fee rate must be > 0 sat/vB.");
  if (params.feeRateSatVb > params.maxFeeRateSatVb) {
    throw new Error(`fee rate ${params.feeRateSatVb} exceeds max ${params.maxFeeRateSatVb}`);
  }

  const psbt = new bitcoin.Psbt({ network: net });
  const seenOutpoints = new Set<string>();

  let totalIn = 0n;
  let hasWitness = false;
  let vsize = 10; // version(4) + vin/vout varints(2) + locktime(4)

  for (let i = 0; i < params.inputs.length; i++) {
    const u = params.inputs[i]!;
    if (u.valueSats < 0n || u.valueSats > MAX_MONEY_SATS) throw new Error("Input value out of range.");
    const outpoint = `${u.txid}:${u.vout}`;
    if (seenOutpoints.has(outpoint)) throw new Error("Duplicate input detected.");
    seenOutpoints.add(outpoint);
    totalIn += u.valueSats;

    const script = Buffer.from(u.scriptPubKeyHex, "hex");
    const value = Number(u.valueSats);
    if (isP2WPKH(script)) {
      hasWitness = true;
      vsize += estimateInputVsize(u.scriptPubKeyHex);
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        sequence: 0xfffffffd, // RBF-signalling
        witnessUtxo: { script, value },
        sighashType: bitcoin.Transaction.SIGHASH_ALL,
      });
    } else if (isP2TR(script)) {
      hasWitness = true;
      vsize += estimateInputVsize(u.scriptPubKeyHex);
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        sequence: 0xfffffffd,
        witnessUtxo: { script, value },
        tapInternalKey: script.subarray(2),
        sighashType: bitcoin.Transaction.SIGHASH_ALL,
      });
    } else {
      // Legacy / nested-segwit inputs need nonWitnessUtxo (the full parent tx),
      // which we do not carry. Reject rather than emit an unsignable PSBT.
      throw new Error(`Input ${i} has an unsupported script type (only P2WPKH/P2TR are signable).`);
    }
  }

  if (hasWitness) vsize += 2; // segwit marker + flag

  let opReturnCount = 0;
  let totalProtocolOut = 0n;
  for (let i = 0; i < params.outputs.length; i++) {
    const o = params.outputs[i]!;
    if (o.valueSats < 0n || o.valueSats > MAX_MONEY_SATS) throw new Error("Output value out of range.");
    const script = resolveOutputScript(o, net);
    if (script[0] === 0x6a) {
      opReturnCount += 1;
      const payload = opReturnPayload(script);
      if (payload && payload.length > MAX_OP_RETURN_PAYLOAD) {
        throw new Error(`OP_RETURN payload ${payload.length} exceeds ${MAX_OP_RETURN_PAYLOAD} bytes.`);
      }
    }
    totalProtocolOut += o.valueSats;
    vsize += estimateOutputVsize(script);
    if (o.address !== undefined) {
      psbt.addOutput({ address: o.address, value: Number(o.valueSats) });
    } else {
      psbt.addOutput({ script, value: Number(o.valueSats) });
    }
  }
  if (opReturnCount > 1) throw new Error("More than one OP_RETURN output (non-relayable).");

  // Change output: measure the real change script, not a flat 31 vB.
  const changeScript = bitcoin.address.toOutputScript(params.changeAddress, net);
  vsize += estimateOutputVsize(changeScript);
  const estFee = BigInt(vsize) * params.feeRateSatVb;
  let changeSats = totalIn - totalProtocolOut - estFee;
  if (changeSats < 0n) throw new Error("Insufficient inputs for fee + outputs.");

  const changeDust = dustThreshold(changeScript);
  if (changeSats >= changeDust) {
    psbt.addOutput({ address: params.changeAddress, value: Number(changeSats) });
  } else {
    // Fold dust change into the fee; never create an unrelayable change output.
    changeSats = 0n;
  }

  // Recompute the ACTUAL fee from the outputs actually added (never an estimate).
  const cached = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE;
  const actualOutTotal = cached.__TX.outs.reduce((acc, out) => acc + BigInt(out.value), 0n);
  const actualFee = totalIn - actualOutTotal;
  if (actualFee < 0n) throw new Error("negative fee");
  if (actualFee !== totalIn - actualOutTotal) throw new Error("fee accounting mismatch");
  if (actualFee > params.maxMinerFeeSats) {
    throw new Error(`fee ${actualFee} exceeds max ${params.maxMinerFeeSats}`);
  }

  const unsignedHex = cached.__TX.toHex();
  const opReturnOut = params.outputs.find((o) => o.script && o.script[0] === 0x6a);
  const opReturnHex = opReturnOut?.script ? Buffer.from(opReturnOut.script).toString("hex") : "";

  return { psbtBase64: psbt.toBase64(), unsignedHex, opReturnHex, feeSats: actualFee, changeSats };
}
