import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import type { ChainUtxo } from "./provider.js";
import { btcNetwork, opReturnPayload, type NetworkName } from "./decoder.js";
import { dustThreshold, isP2TR, isP2WPKH } from "./dust.js";

// Taproot address/script derivation requires an ECC library. Init once at
// module load so P2TR change/output addresses work end-to-end.
bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

export interface CovePsbt {
  psbtBase64: string;
  /** Unsigned raw transaction hex (pre-signature), for validation/display. */
  unsignedHex: string;
  opReturnHex: string;
  /** UTF-8 best-effort of the OP_RETURN payload (lossy for binary envelopes). */
  opReturnJson: string;
  feeSats: bigint;
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
  outputs: { address?: string; script?: Buffer; valueSats: bigint }[];
  changeAddress: string;
  feeRateSatVb: bigint;
}

const MAX_MONEY_SATS = 2_100_000_000_000_000n; // 21M BTC

/**
 * Conservative signed-input vbyte estimate per script type.
 * Non-witness input base is 41 vbytes (outpoint 36 + empty scriptSig 1 +
 * sequence 4); witness adds ceil(witnessBytes/4):
 *   P2WPKH witness ≈ 108 bytes → +27  ⇒ 68
 *   P2TR   witness ≈ 66 bytes  → +17  ⇒ 58
 * Legacy P2PKH is 148 vbytes.
 */
export function estimateInputVsize(scriptPubKeyHex: string): number {
  const script = Buffer.from(scriptPubKeyHex, "hex");
  if (isP2TR(script)) return 58;
  if (isP2WPKH(script)) return 68;
  return 148;
}

/** Serialized output size: 8 (value) + 1 (script-len varint, len<253) + len. */
export function estimateOutputVsize(script: Uint8Array): number {
  return 8 + 1 + script.length;
}

/** Resolve an output's script from address or raw script (validates network). */
function resolveOutputScript(
  out: { address?: string; script?: Buffer },
  net: bitcoin.networks.Network,
): Buffer {
  if (out.script) return out.script;
  if (out.address) return bitcoin.address.toOutputScript(out.address, net);
  throw new Error("Output must specify address or script.");
}

/**
 * Build an unsigned PSBT from inputs + explicit protocol outputs + a change
 * output. Script-aware conservative vsize; rejects duplicate outpoints, zero
 * inputs, out-of-range values, and wrong-network change addresses. No private
 * keys are held here.
 */
export function buildUnsignedPsbt(params: BuildTxParams): CovePsbt {
  const net = btcNetwork(params.network);
  if (params.inputs.length === 0) throw new Error("No inputs provided.");
  if (params.feeRateSatVb < 0n) throw new Error("Negative fee rate.");

  const psbt = new bitcoin.Psbt({ network: net });
  const seenOutpoints = new Set<string>();

  let totalIn = 0n;
  let hasWitness = false;
  let vsize = 10; // version(4) + vin/vout varints(2) + locktime(4)

  for (const u of params.inputs) {
    if (u.valueSats < 0n || u.valueSats > MAX_MONEY_SATS) throw new Error("Input value out of range.");
    const outpoint = `${u.txid}:${u.vout}`;
    if (seenOutpoints.has(outpoint)) throw new Error("Duplicate input detected.");
    seenOutpoints.add(outpoint);
    totalIn += u.valueSats;
    const script = Buffer.from(u.scriptPubKeyHex, "hex");
    if (isP2WPKH(script) || isP2TR(script)) hasWitness = true;
    vsize += estimateInputVsize(u.scriptPubKeyHex);
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script, value: Number(u.valueSats) },
    });
  }

  if (hasWitness) vsize += 2; // segwit marker + flag

  let totalProtocolOut = 0n;
  for (const o of params.outputs) {
    if (o.valueSats < 0n || o.valueSats > MAX_MONEY_SATS) throw new Error("Output value out of range.");
    const script = resolveOutputScript(o, net);
    totalProtocolOut += o.valueSats;
    vsize += estimateOutputVsize(script);
    if (o.address) {
      psbt.addOutput({ address: o.address, value: Number(o.valueSats) });
    } else {
      psbt.addOutput({ script, value: Number(o.valueSats) });
    }
  }

  // Change output estimate (assume P2WPKH = 31 vbytes; conservative enough).
  vsize += 31;
  const estFee = BigInt(vsize) * params.feeRateSatVb;
  let changeSats = totalIn - totalProtocolOut - estFee;
  if (changeSats < 0n) throw new Error("Insufficient inputs for fee + outputs.");

  // Validate the change address network and apply script-aware dust.
  const changeScript = bitcoin.address.toOutputScript(params.changeAddress, net);
  const changeDust = dustThreshold(changeScript);
  let feeSats = estFee;
  if (changeSats >= changeDust) {
    psbt.addOutput({ address: params.changeAddress, value: Number(changeSats) });
  } else {
    // Fold dust change into the fee (never create an unrelayable change output).
    feeSats = estFee + changeSats;
    changeSats = 0n;
  }

  // The unsigned transaction is the PSBT's cached tx. `Psbt.toHex()` returns
  // the PSBT binary (magic "psbt"), NOT the transaction, so we read the cached
  // unsigned tx directly for a valid raw-tx hex.
  const cached = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE;
  const unsignedHex = cached.__TX.toHex();

  // Extract the OP_RETURN from the protocol outputs we control.
  const opReturnOut = params.outputs.find((o) => o.script && o.script[0] === 0x6a);
  const opReturnHex = opReturnOut?.script ? opReturnOut.script.toString("hex") : "";
  const payload = opReturnOut?.script ? opReturnPayload(opReturnOut.script) : undefined;
  const opReturnJson = payload ? Buffer.from(payload).toString("utf8") : "";

  return { psbtBase64: psbt.toBase64(), unsignedHex, opReturnHex, opReturnJson, feeSats, changeSats };
}
