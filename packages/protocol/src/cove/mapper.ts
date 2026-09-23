import type { BitcoinProtocolTx } from "@crclaunch/bitcoin";
import type { CoveEnvelope } from "./parser.js";
import type { CoveTransaction, ProtocolOwnerId } from "./types.js";

export type CoveMapResult = { ok: true; tx: CoveTransaction } | { ok: false; reason: string };

/**
 * Map a decoded Bitcoin transaction + parsed Cove envelope into a normalized
 * CoveTransaction. Actor = input 0's spent-UTXO scriptPubKey; recipient =
 * vout 1 scriptPubKey (mint/transfer). Required protocol outputs are assigned
 * deterministic roles by vout index.
 */
export function toCoveTransaction(btcTx: BitcoinProtocolTx, envelope: CoveEnvelope): CoveMapResult {
  const input0 = btcTx.inputs[0];
  if (!input0?.prevScriptPubKeyHex) return { ok: false, reason: "MISSING_INPUT0_PREVOUT" };
  const actor: ProtocolOwnerId = input0.prevScriptPubKeyHex;

  if (envelope.op === "deploy") {
    const feeOut = btcTx.outputs[1];
    return {
      ok: true,
      tx: {
        protocol: "cove",
        version: 1,
        operation: "DEPLOY",
        txid: btcTx.txid,
        actor,
        ticker: envelope.tick,
        protocolOutputs: feeOut
          ? [
              {
                index: 1,
                scriptPubKeyHex: feeOut.scriptPubKeyHex,
                amountSats: feeOut.valueSats,
                role: "launch-fee",
              },
            ]
          : [],
      },
    };
  }

  if (envelope.op === "mint") {
    const recipient = btcTx.outputs[1];
    const curve = btcTx.outputs[2];
    const fee = btcTx.outputs[3];
    return {
      ok: true,
      tx: {
        protocol: "cove",
        version: 1,
        operation: "MINT",
        txid: btcTx.txid,
        actor,
        recipient: recipient?.scriptPubKeyHex,
        ticker: envelope.tick,
        tokenAmount: envelope.amt,
        supplyBefore: envelope.s,
        protocolOutputs: [
          recipient
            ? {
                index: 1,
                scriptPubKeyHex: recipient.scriptPubKeyHex,
                amountSats: recipient.valueSats,
                role: "recipient",
              }
            : undefined,
          curve
            ? {
                index: 2,
                scriptPubKeyHex: curve.scriptPubKeyHex,
                amountSats: curve.valueSats,
                role: "curve",
              }
            : undefined,
          fee
            ? {
                index: 3,
                scriptPubKeyHex: fee.scriptPubKeyHex,
                amountSats: fee.valueSats,
                role: "platform-fee",
              }
            : undefined,
        ].filter((o): o is NonNullable<typeof o> => o !== undefined),
      },
    };
  }

  // transfer
  const recipient = btcTx.outputs[1];
  return {
    ok: true,
    tx: {
      protocol: "cove",
      version: 1,
      operation: "TRANSFER",
      txid: btcTx.txid,
      actor,
      recipient: recipient?.scriptPubKeyHex,
      ticker: envelope.tick,
      tokenAmount: envelope.amt,
      protocolOutputs: recipient
        ? [
            {
              index: 1,
              scriptPubKeyHex: recipient.scriptPubKeyHex,
              amountSats: recipient.valueSats,
              role: "recipient",
            },
          ]
        : [],
    },
  };
}
