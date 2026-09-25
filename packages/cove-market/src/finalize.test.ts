import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { buildTransferPsbtV2 } from "@crclaunch/cove-guardian/v3";
import { CoveChainView, TOKEN_CARRIER_SATS, s0StateV2 } from "@crclaunch/cove-covenant";
import { COVE_FEE_CONFIG, deterministicFee } from "@crclaunch/cove-economics";
import { validateFinalizedP2PFill, assertSettlementCap, type P2PFillTerms } from "./finalize.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);
const seller = ECPair.fromPrivateKey(Buffer.alloc(32, 0x46));
const buyer = ECPair.fromPrivateKey(Buffer.alloc(32, 0x49));
const fee = ECPair.fromPrivateKey(Buffer.alloc(32, 0x44));
const p2wpkh = (k: typeof seller) =>
  bitcoin.payments.p2wpkh({ pubkey: k.publicKey, network: bitcoin.networks.regtest }).output!;

const tokenId = Buffer.alloc(32, 0x0b);
const tokenIdHex = tokenId.toString("hex");
const sourceTxid = "11".repeat(32);
const sourceVout = 0;
const sourceAmount = 84_000_000n * 100_000_000n;
const amount = 42_000_000n * 100_000_000n;
const totalPrice = 100_000n;
const marketFee = deterministicFee(totalPrice, COVE_FEE_CONFIG.p2pFeeBps);
const minerFee = 1_000n;

function view(): CoveChainView {
  const v = new CoveChainView();
  v.deploy(
    { tokenId, ticker: "FROG", policyVersion: 3, deployTxid: "33".repeat(32), tokenNonce: Buffer.alloc(32, 0xab) },
    { txid: "ff".repeat(32), vout: 0 },
    s0StateV2({ tokenId: tokenIdHex }),
  );
  v.tokenUtxos.set(`${sourceTxid}:${sourceVout}`, {
    outpoint: { txid: sourceTxid, vout: sourceVout },
    tokenId,
    amountAtoms: sourceAmount,
    scriptPubKey: p2wpkh(seller),
  });
  return v;
}

function buildTerms(overrides: Partial<P2PFillTerms> = {}): P2PFillTerms {
  return {
    listingId: "ab".repeat(32),
    fillId: "cd".repeat(16),
    tokenId: tokenIdHex,
    sourceTxid,
    sourceVout,
    sourceAmountAtoms: sourceAmount,
    sellerTokenScript: p2wpkh(seller),
    sellerTokenChangeScript: p2wpkh(seller),
    sellerPayoutScript: p2wpkh(seller),
    amountAtoms: amount,
    totalPriceSats: totalPrice,
    marketFeeSats: marketFee,
    minerFeeSats: minerFee,
    buyerTokenScript: p2wpkh(buyer),
    buyerChangeScript: p2wpkh(buyer),
    feeScript: p2wpkh(fee),
    buyerFundInputs: [{ txid: "22".repeat(32), vout: 0, script: p2wpkh(buyer), valueSats: 200_000n }],
    ...overrides,
  };
}

function buildSigned(terms: P2PFillTerms): string {
  const changeAtoms = terms.sourceAmountAtoms - terms.amountAtoms;
  const tokenOutputs = [{ script: terms.buyerTokenScript, amountAtoms: terms.amountAtoms }];
  if (changeAtoms > 0n) tokenOutputs.push({ script: terms.sellerTokenChangeScript, amountAtoms: changeAtoms });
  const psbt = buildTransferPsbtV2({
    network: bitcoin.networks.regtest,
    tokenId: Buffer.from(terms.tokenId, "hex"),
    tokenInputs: [{ txid: terms.sourceTxid, vout: terms.sourceVout, script: terms.sellerTokenScript, valueSats: TOKEN_CARRIER_SATS }],
    tokenInputTotalAtoms: terms.sourceAmountAtoms,
    tokenOutputs,
    funderInputs: terms.buyerFundInputs.map((f) => ({ txid: f.txid, vout: f.vout, script: f.script, valueSats: f.valueSats })),
    funderChangeScript: terms.buyerChangeScript,
    btcOutputs: [
      { script: terms.sellerPayoutScript, valueSats: terms.totalPriceSats },
      { script: terms.feeScript, valueSats: terms.marketFeeSats },
    ],
    minerFeeSats: terms.minerFeeSats,
  }).psbt;
  psbt.signInput(0, seller);
  psbt.signInput(1, buyer);
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

describe("validateFinalizedP2PFill (§14)", () => {
  it("accepts a well-formed partial-Utxo fill (84M → 42M buyer + 42M change)", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    const v = view();
    const out = validateFinalizedP2PFill({ rawTxHex: hex, terms, view: v, network: "regtest" });
    expect(out.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(out.tokenId).toBe(tokenIdHex);
    expect(out.validatedTransfer.operation).toBe("TRANSFER");
  });

  it("rejects a tampered transaction (output value mutation)", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    const tx = bitcoin.Transaction.fromHex(hex);
    tx.outs[3]!.value += 1; // seller payout output
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: tx.toHex(), terms, view: view(), network: "regtest" }),
    ).toThrow();
  });

  it("rejects a wrong seller payout", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: hex, terms: buildTerms({ totalPriceSats: 100_001n }), view: view(), network: "regtest" }),
    ).toThrow(/SELLER_PAYOUT/);
  });

  it("rejects a wrong p2p fee", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: hex, terms: buildTerms({ marketFeeSats: marketFee + 1n }), view: view(), network: "regtest" }),
    ).toThrow(/P2P_FEE/);
  });

  it("rejects a wrong miner fee", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: hex, terms: buildTerms({ minerFeeSats: minerFee + 1n }), view: view(), network: "regtest" }),
    ).toThrow(/MINER_FEE/);
  });

  it("rejects a wrong buyer allocation amount", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: hex, terms: buildTerms({ amountAtoms: amount - 100n }), view: view(), network: "regtest" }),
    ).toThrow(/BUYER_ALLOCATION/);
  });

  it("rejects when the source input is not the listing outpoint", () => {
    const terms = buildTerms();
    const hex = buildSigned(terms);
    expect(() =>
      validateFinalizedP2PFill({ rawTxHex: hex, terms: buildTerms({ sourceTxid: "99".repeat(32) }), view: view(), network: "regtest" }),
    ).toThrow(/SOURCE_INPUT/);
  });
});

describe("assertSettlementCap (§P0-6)", () => {
  it("allows a settlement at or below the cap", () => {
    expect(() => assertSettlementCap(10_000_000n, 10_000_000n)).not.toThrow();
    expect(() => assertSettlementCap(9_999_999n, 10_000_000n)).not.toThrow();
  });

  it("allows any settlement when no cap is configured (dev/regtest)", () => {
    expect(() => assertSettlementCap(1_000_000_000_000n, null)).not.toThrow();
    expect(() => assertSettlementCap(1_000_000_000_000n, undefined)).not.toThrow();
  });

  it("rejects a settlement above the cap", () => {
    expect(() => assertSettlementCap(10_000_001n, 10_000_000n)).toThrow(/P2P_SETTLEMENT_CAP_EXCEEDED/);
  });
});
