import * as bitcoin from "bitcoinjs-lib";
import type { ChainUtxo } from "./provider.js";
import { btcNetwork, opReturnPayload, type NetworkName } from "./decoder.js";

export interface CovePsbt {
  psbtBase64: string;
  /** Unsigned raw transaction hex (pre-signature), for validation/display. */
  unsignedHex: string;
  opReturnHex: string;
  opReturnJson: string;
  feeSats: bigint;
  changeSats: bigint;
}

/** Build an OP_RETURN script carrying a single UTF-8 JSON push. */
export function opReturnScript(json: string): Buffer {
  return bitcoin.script.compile([0x6a, Buffer.from(json, "utf8")]);
}

export interface BuildTxParams {
  network: NetworkName;
  inputs: ChainUtxo[];
  outputs: { address?: string; script?: Buffer; valueSats: bigint }[];
  changeAddress: string;
  feeRateSatVb: bigint;
}

/**
 * Build an unsigned PSBT from inputs + explicit protocol outputs + a change
 * output. The fee is derived from a simple vbyte estimate; the wallet may
 * adjust via change. No private keys are held here.
 */
export function buildUnsignedPsbt(params: BuildTxParams): CovePsbt {
  const net = btcNetwork(params.network);
  const psbt = new bitcoin.Psbt({ network: net });

  let totalIn = 0n;
  for (const u of params.inputs) {
    totalIn += u.valueSats;
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: Buffer.from(u.scriptPubKeyHex, "hex"), value: Number(u.valueSats) },
    });
  }

  let totalProtocolOut = 0n;
  for (const o of params.outputs) {
    totalProtocolOut += o.valueSats;
    if (o.address) {
      psbt.addOutput({ address: o.address, value: Number(o.valueSats) });
    } else if (o.script) {
      psbt.addOutput({ script: o.script, value: Number(o.valueSats) });
    }
  }

  // Estimate size: inputs/outputs (P2WPKH-ish) to derive a change amount.
  const vsize = params.inputs.length * 68 + (params.outputs.length + 1) * 31 + 11;
  const feeSats = BigInt(vsize) * params.feeRateSatVb;
  const changeSats = totalIn - totalProtocolOut - feeSats;
  if (changeSats < 546n) {
    // Not enough for change; fold it into fee (or fail if negative).
    if (totalIn - totalProtocolOut < feeSats) {
      throw new Error("Insufficient inputs for fee + outputs.");
    }
  } else {
    psbt.addOutput({ address: params.changeAddress, value: Number(changeSats) });
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

  return {
    psbtBase64: psbt.toBase64(),
    unsignedHex,
    opReturnHex,
    opReturnJson,
    feeSats,
    changeSats,
  };
}
