import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import {
  checkSpendSignature,
  inputVbytes,
  psbtInputFor,
  scriptForKind,
  spendKindOf,
  unfinalizeKeyInputs,
  xOnly,
  type SpendKind,
} from "./spend.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);
const NET = bitcoin.networks.regtest;

const owner = ECPair.fromPrivateKey(Buffer.alloc(32, 0x51), { network: NET });
const stranger = ECPair.fromPrivateKey(Buffer.alloc(32, 0x52), { network: NET });
const DEST = bitcoin.payments.p2wpkh({ pubkey: stranger.publicKey, network: NET }).output!;

/**
 * Taproot key-path spending tweaks the internal key, so the signature must be
 * made with the tweaked private key rather than the raw one.
 */
function tweaked(key: ReturnType<typeof ECPair.fromPrivateKey>) {
  const tweak = bitcoin.crypto.taggedHash("TapTweak", xOnly(key.publicKey));
  const tweakedKey = ecc.privateAdd(
    key.publicKey[0] === 3 ? ecc.privateNegate(key.privateKey!) : key.privateKey!,
    tweak,
  );
  return ECPair.fromPrivateKey(Buffer.from(tweakedKey!), { network: NET });
}

/** Build, sign and finalize a one-input spend of the given kind. */
function roundTrip(kind: SpendKind) {
  const script = scriptForKind(kind, owner.publicKey, NET);
  const psbt = new bitcoin.Psbt({ network: NET });
  psbt.addInput(
    psbtInputFor(
      {
        txid: "aa".repeat(32),
        vout: 0,
        script,
        valueSats: 100_000n,
        publicKey: Buffer.from(owner.publicKey),
      },
      NET,
    ),
  );
  psbt.addOutput({ script: DEST, value: 99_000 });

  if (kind === "p2tr") {
    psbt.signInput(0, tweaked(owner));
  } else {
    psbt.signInput(0, owner);
  }
  return { psbt, script };
}

describe("spendKindOf", () => {
  it("recognises the three kinds a wallet can hand out", () => {
    expect(spendKindOf(scriptForKind("p2wpkh", owner.publicKey, NET))).toBe("p2wpkh");
    expect(spendKindOf(scriptForKind("p2sh-p2wpkh", owner.publicKey, NET))).toBe("p2sh-p2wpkh");
    expect(spendKindOf(scriptForKind("p2tr", owner.publicKey, NET))).toBe("p2tr");
  });

  it("refuses an unknown script rather than guessing", () => {
    // Bare P2PKH: legal Bitcoin, but not something Cove builds a spend for.
    const p2pkh = bitcoin.payments.p2pkh({ pubkey: owner.publicKey, network: NET }).output!;
    expect(spendKindOf(p2pkh)).toBeNull();
  });
});

describe("a real wallet can sign every kind Cove builds", () => {
  for (const kind of ["p2wpkh", "p2sh-p2wpkh", "p2tr"] as const) {
    it(`signs, validates and finalizes ${kind}`, () => {
      const { psbt } = roundTrip(kind);

      expect(checkSpendSignature(psbt, 0)).toEqual({ ok: true });

      // Finalizing is the real proof: it fails outright if the PSBT was
      // missing the redeemScript or the internal key the kind requires.
      psbt.finalizeAllInputs();
      const tx = psbt.extractTransaction();
      expect(tx.ins).toHaveLength(1);
      expect(tx.virtualSize()).toBeLessThanOrEqual(inputVbytes(kind) + 43);
    });
  }

  it("prices each kind the way Bitcoin serializes it", () => {
    // Measured against the finalized transactions above, less one 31-vbyte
    // P2WPKH output and 11 vbytes of overhead.
    for (const kind of ["p2wpkh", "p2sh-p2wpkh", "p2tr"] as const) {
      const { psbt } = roundTrip(kind);
      psbt.finalizeAllInputs();
      const measured = psbt.extractTransaction().virtualSize() - 31 - 11;
      expect(inputVbytes(kind)).toBeGreaterThanOrEqual(measured);
      expect(inputVbytes(kind) - measured).toBeLessThanOrEqual(2);
    }
  });
});

describe("checkSpendSignature refuses what it should", () => {
  it("rejects an unsigned input", () => {
    const script = scriptForKind("p2wpkh", owner.publicKey, NET);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput(
      psbtInputFor({ txid: "bb".repeat(32), vout: 0, script, valueSats: 1_000n }, NET),
    );
    psbt.addOutput({ script: DEST, value: 900 });
    expect(checkSpendSignature(psbt, 0)).toMatchObject({ ok: false, reason: "UNSIGNED" });
  });

  it("rejects a signature that does not commit to every output", () => {
    const script = scriptForKind("p2wpkh", owner.publicKey, NET);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({
      ...psbtInputFor({ txid: "cc".repeat(32), vout: 0, script, valueSats: 100_000n }, NET),
      sighashType: bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
    });
    psbt.addOutput({ script: DEST, value: 99_000 });
    psbt.signInput(0, owner, [
      bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
    ]);
    expect(checkSpendSignature(psbt, 0)).toMatchObject({ ok: false, reason: "NOT_SIGHASH_ALL" });
  });

  it("rejects a taproot signature carrying a non-ALL sighash flag", () => {
    const { psbt } = roundTrip("p2tr");
    const signed = psbt.data.inputs[0]!.tapKeySig!;
    // Append an explicit SIGHASH_SINGLE flag to the 64-byte signature.
    psbt.data.inputs[0]!.tapKeySig = Buffer.concat([
      Buffer.from(signed.subarray(0, 64)),
      Buffer.from([bitcoin.Transaction.SIGHASH_SINGLE]),
    ]);
    expect(checkSpendSignature(psbt, 0)).toMatchObject({ ok: false, reason: "NOT_SIGHASH_ALL" });
  });

  it("rejects a valid signature from the wrong key", () => {
    const script = scriptForKind("p2wpkh", owner.publicKey, NET);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput(
      psbtInputFor({ txid: "dd".repeat(32), vout: 0, script, valueSats: 100_000n }, NET),
    );
    psbt.addOutput({ script: DEST, value: 99_000 });
    // bitcoinjs refuses to sign with a key that does not own the input, which
    // is itself the protection; assert it rather than forging past it.
    expect(() => psbt.signInput(0, stranger)).toThrow();
  });
});

describe("psbtInputFor", () => {
  it("refuses to build an input it cannot describe to a wallet", () => {
    const p2pkh = bitcoin.payments.p2pkh({ pubkey: owner.publicKey, network: NET }).output!;
    expect(() =>
      psbtInputFor({ txid: "ee".repeat(32), vout: 0, script: p2pkh, valueSats: 1n }, NET),
    ).toThrow(/unsupported address type/);
  });

  it("refuses a nested-segwit or taproot input with no public key", () => {
    for (const kind of ["p2sh-p2wpkh", "p2tr"] as const) {
      const script = scriptForKind(kind, owner.publicKey, NET);
      expect(() =>
        psbtInputFor({ txid: "ff".repeat(32), vout: 0, script, valueSats: 1n }, NET),
      ).toThrow(/needs the owner's public key/);
    }
  });

  it("refuses a public key that does not control the output", () => {
    const script = scriptForKind("p2tr", owner.publicKey, NET);
    expect(() =>
      psbtInputFor(
        {
          txid: "ab".repeat(32),
          vout: 0,
          script,
          valueSats: 1n,
          publicKey: Buffer.from(stranger.publicKey),
        },
        NET,
      ),
    ).toThrow(/does not control it/);
  });
});

describe("a wallet that finalizes its own inputs", () => {
  for (const kind of ["p2wpkh", "p2sh-p2wpkh", "p2tr"] as const) {
    it(`is read back as signed (${kind})`, () => {
      const { psbt } = roundTrip(kind);
      psbt.finalizeAllInputs();
      const expected = psbt.extractTransaction().toHex();

      // As it arrives from the wallet: signature only in the final witness.
      const received = bitcoin.Psbt.fromBase64(psbt.toBase64(), { network: NET });
      expect(checkSpendSignature(received, 0).ok).toBe(false);

      unfinalizeKeyInputs(received);
      expect(checkSpendSignature(received, 0)).toEqual({ ok: true });
      received.finalizeAllInputs();
      expect(received.extractTransaction().toHex()).toBe(expected);
    });
  }
});
