import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

/**
 * Deterministic regtest E2E signing primitives (§21). These hold NO keys and
 * are used ONLY by the Playwright test harness (Node) with the deterministic
 * REGTEST fixture keys. They must NEVER be imported by a production client
 * bundle — the architecture gate scans for that.
 */

export function signPsbtWithKey(psbtBase64: string, privKeyHex: string, network: bitcoin.networks.Network = bitcoin.networks.regtest): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  const key = ECPair.fromPrivateKey(Buffer.from(privKeyHex, "hex"), { network });
  const script = bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network }).output!;
  const indexes: number[] = [];
  psbt.data.inputs.forEach((input, i) => {
    if (input.witnessUtxo && input.witnessUtxo.script.equals(script) && !input.partialSig?.length) indexes.push(i);
  });
  for (const i of indexes) psbt.signInput(i, key);
  return psbt.toBase64();
}

export function signBip322WithKey(message: string, privKeyHex: string, network: bitcoin.networks.Network = bitcoin.networks.regtest): string {
  const key = ECPair.fromPrivateKey(Buffer.from(privKeyHex, "hex"), { network });
  const scriptPubKey = bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network }).output!;
  const messageHash = bitcoin.crypto.sha256(Buffer.from(message, "utf8"));

  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptPubKey);
  toSpend.addOutput(bitcoin.script.compile([0x6a, messageHash]), 0);
  toSpend.addOutput(scriptPubKey, 0);

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.addInput(toSpend.getHash(), 1, 0);
  toSign.addOutput(bitcoin.script.compile([0x6a]), 0);

  const sighash = toSign.hashForWitnessV0(0, scriptPubKey, 0, bitcoin.Transaction.SIGHASH_ALL);
  const sig = bitcoin.script.signature.encode(key.sign(Buffer.from(sighash)), bitcoin.Transaction.SIGHASH_ALL);
  toSign.setWitness(0, [sig, Buffer.from(key.publicKey)]);

  const ts = toSpend.toBuffer();
  const tn = toSign.toBuffer();
  const compactSize = (n: number): Buffer => {
    if (n < 0xfd) return Buffer.from([n]);
    if (n <= 0xffff) {
      const b = Buffer.alloc(3);
      b[0] = 0xfd;
      b.writeUInt16LE(n, 1);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(n, 1);
    return b;
  };
  return Buffer.concat([compactSize(ts.length), ts, compactSize(tn.length), tn]).toString("base64");
}
