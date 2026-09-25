import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { verifyClientIntent, unsignedTxDigestHex, type ClientIntent } from "./cove-intent.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

function scriptFor(byte: number): Buffer {
  const k = ECPair.fromPrivateKey(Buffer.alloc(32, byte));
  return bitcoin.payments.p2wpkh({ pubkey: k.publicKey, network: bitcoin.networks.regtest }).output!;
}

const walletScript = scriptFor(0x49);
const attackerScript = scriptFor(0x59);

function intentFor(psbt: bitcoin.Psbt, overrides: Partial<ClientIntent> = {}): ClientIntent {
  const totalIn = psbt.data.inputs.reduce((s, i) => s + BigInt(i.witnessUtxo?.value ?? 0), 0n);
  const totalOut = psbt.txOutputs.reduce((s, o) => s + BigInt(o.value), 0n);
  return {
    operation: "REDEEM",
    tokenId: "ab".repeat(32),
    tokenAmountAtoms: "4200000000000000",
    grossSats: "21000",
    protocolFeeSats: "210",
    minerFeeSats: (totalIn - totalOut).toString(),
    netSats: "20790",
    walletScript: walletScript.toString("hex"),
    stateHash: "cd".repeat(32),
    unsignedTxDigest: unsignedTxDigestHex(psbt),
    ...overrides,
  };
}

function buildPsbt(payoutScript: Buffer): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
  psbt.addInput({ hash: "22".repeat(32), index: 0, witnessUtxo: { script: walletScript, value: 50_000 } });
  psbt.addOutput({ script: payoutScript, value: 20_790 });
  psbt.addOutput({ script: attackerScript, value: 210 });
  return psbt;
}

describe("verifyClientIntent output re-derivation (§M3)", () => {
  it("accepts a PSBT whose digest AND outputs match the intent", () => {
    const psbt = buildPsbt(walletScript);
    expect(() => verifyClientIntent(psbt.toBase64(), intentFor(psbt))).not.toThrow();
  });

  it("rejects a hostile PSBT whose digest matches but payout is redirected to an attacker", () => {
    const psbt = buildPsbt(attackerScript); // payout to attacker; digest still matches the (server-supplied) intent
    expect(() => verifyClientIntent(psbt.toBase64(), intentFor(psbt))).toThrow(/payout does not go to the wallet/);
  });

  it("rejects a hostile PSBT whose digest matches but the miner fee is inflated", () => {
    const psbt = buildPsbt(walletScript);
    // Server quotes minerFeeSats lower than the actual fee (hidden output).
    expect(() => verifyClientIntent(psbt.toBase64(), intentFor(psbt, { minerFeeSats: "0" }))).toThrow(/miner fee/);
  });

  it("rejects a hostile PSBT whose digest matches but the protocol fee output is missing", () => {
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    psbt.addInput({ hash: "22".repeat(32), index: 0, witnessUtxo: { script: walletScript, value: 50_000 } });
    psbt.addOutput({ script: walletScript, value: 20_790 }); // no fee output
    const totalIn = 50_000n;
    const totalOut = 20_790n;
    expect(() => verifyClientIntent(psbt.toBase64(), intentFor(psbt, { minerFeeSats: (totalIn - totalOut).toString(), protocolFeeSats: "210" }))).toThrow(/protocol fee output missing/);
  });
});
