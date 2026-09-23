/**
 * Cove covenant Phase 1 regtest proof (deterministic, OFFLINE — no bitcoind
 * required). Demonstrates:
 *   1. fixed-width state encoding + domain-separated hash
 *   2. state-committed P2TR derivation (S0 != S1 ⇒ different output)
 *   3. S0 → S1 MINT transition
 *   4. Guardian validates + Schnorr-authorizes (signs only AFTER validation)
 *   5. adversarial rejections (successor / payment / recipient manipulation)
 *   6. a real Bitcoin taproot key-path PSBT spending the S0 state UTXO → S1
 *
 * Bitcoin enforces the Taproot key-path signature. The Guardian enforces the
 * transition policy; Bitcoin consensus does NOT evaluate it under mainnet rules.
 */
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import {
  applyMint,
  deriveStateOutput,
  stateCommitment,
  stateHash,
  stateOutputScript,
  stateTweak,
  type CoveState,
} from "@crclaunch/cove-covenant";
import { TaprootGuardianSigner, validateMint } from "@crclaunch/cove-guardian";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const WIF = "cPoVxi18CnxHUQjYNpjRM3RYUVFA61wuTNQez7BtRKkfp9Fw6RTW";
const RECIPIENT = Buffer.from("5120" + "cc".repeat(32), "hex");
const MINT_42M = 42_000_000n * 100_000_000n;
const S0: CoveState = {
  version: 1,
  tokenId: "ab".repeat(32),
  phase: "PUBLIC_MINT",
  publicSupplyAtoms: 0n,
  reserveSats: 0n,
  curveStage: 1,
};

function main(): void {
  const line = "─".repeat(70);
  console.log(line);
  console.log("COVE COVENANT PHASE 1 — STATE-COMMITTED TAPROOT PROOF (regtest params)");
  console.log(line);

  const signer = new TaprootGuardianSigner(WIF, "regtest");
  console.log(`\nGuardian internal key P: ${signer.internalKey.toString("hex")}`);

  // 1. State encoding + hash
  console.log("\n[1] State encoding + domain-separated hash");
  console.log(`    S0 hash: ${stateHash(S0)}`);

  // 2. State-committed P2TR
  console.log("\n[2] State-committed P2TR (S0 vs S1 differ)");
  const o0 = deriveStateOutput(signer.internalKey, S0, bitcoin.networks.regtest);
  console.log(`    S0 output: ${o0.scriptPubKeyHex}`);
  console.log(`    S0 address: ${o0.address}`);

  // 3. Transition
  console.log("\n[3] MINT transition S0 → S1 (42M tokens)");
  const mint = applyMint(S0, MINT_42M);
  const S1 = mint.nextState;
  const o1 = deriveStateOutput(signer.internalKey, S1, bitcoin.networks.regtest);
  console.log(`    curve contribution: ${mint.curveContributionSats} sats`);
  console.log(
    `    S1 supply: ${S1.publicSupplyAtoms} atoms, reserve: ${S1.reserveSats} sats, stage: ${S1.curveStage}`,
  );
  console.log(`    S1 hash: ${stateHash(S1)}`);
  console.log(`    S1 output: ${o1.scriptPubKeyHex}`);

  // 4. Guardian validation + authorization
  console.log("\n[4] Guardian validation + authorization");
  const ctx = {
    prevState: S0,
    nextState: S1,
    amountAtoms: MINT_42M,
    curveContributionSats: mint.curveContributionSats,
    feeSats: 1_000n,
    recipientCommitment: RECIPIENT,
    network: "regtest" as const,
  };
  const decision = validateMint(ctx);
  console.log(`    validateMint: ${decision.ok ? "PASS" : "REJECT: " + decision.reason}`);
  const auth = signer.authorizeMint(ctx);
  console.log(`    transition digest: ${auth.digest.toString("hex")}`);
  console.log(`    Schnorr signature: ${auth.signature.toString("hex").slice(0, 32)}… (64 bytes)`);
  console.log(`    signature verifies: ${signer.verifyAuthorization(auth) ? "YES" : "NO"}`);

  // 5. Adversarial rejections
  console.log("\n[5] Adversarial rejections (Guardian must refuse to sign)");
  const cases: [string, Partial<typeof ctx>][] = [
    ["manipulated successor state", { nextState: { ...S1, reserveSats: S1.reserveSats + 1n } }],
    ["manipulated payment", { curveContributionSats: mint.curveContributionSats + 1n }],
    ["manipulated recipient", { recipientCommitment: Buffer.from("deadbeef", "hex") }],
  ];
  for (const [label, patch] of cases) {
    const bad = { ...ctx, ...patch };
    const d = validateMint(bad);
    let signed = true;
    try {
      signer.authorizeMint(bad);
    } catch {
      signed = false;
    }
    console.log(
      `    ${label}: validate=${d.ok ? "PASS" : "REJECT:" + d.reason}  signerRefused=${!signed ? "YES" : "NO"}`,
    );
  }

  // 6. Real taproot key-path PSBT: S0 UTXO → S1 UTXO
  console.log("\n[6] Real Bitcoin taproot key-path spend (S0 → S1)");
  const funding = { txid: "d".repeat(64), vout: 0, valueSats: 1_000_000n, feeSats: 300n };
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
  psbt.addInput({
    hash: funding.txid,
    index: funding.vout,
    witnessUtxo: {
      script: stateOutputScript(S0, signer.internalKey),
      value: Number(funding.valueSats),
    },
    tapInternalKey: signer.internalKey,
    tapMerkleRoot: stateCommitment(S0),
  });
  psbt.addOutput({
    script: stateOutputScript(S1, signer.internalKey),
    value: Number(funding.valueSats - funding.feeSats),
  });
  // Key-path signing signs with the OUTPUT key Q0 = P + t·G, not the untweaked
  // internal key P. Build the tweaked key pair: private key = d + t (mod n),
  // where t = H_TapTweak(P || stateCommitment(S0)).
  const tweak = stateTweak(signer.internalKey, S0);
  const tweakedKey = ECPair.fromWIF(WIF, bitcoin.networks.regtest).tweak(tweak);
  psbt.signTaprootInput(0, tweakedKey);
  psbt.finalizeInput(0);
  const txHex = psbt.extractTransaction().toHex();
  const decoded = bitcoin.Transaction.fromHex(txHex);
  const successorOut = decoded.outs[0]!.script.toString("hex");
  console.log(`    txid: ${decoded.getId()}`);
  console.log(`    successor output: ${successorOut}`);
  console.log(
    `    successor commits to S1: ${successorOut === stateOutputScript(S1, signer.internalKey).toString("hex") ? "YES" : "NO"}`,
  );

  // 6b. Independently verify the key-path Schnorr signature (this is exactly
  //     what a Bitcoin node's Taproot validation does on this input).
  const witnessSig = decoded.ins[0]!.witness[0]!;
  const q0 = deriveStateOutput(signer.internalKey, S0, bitcoin.networks.regtest).outputKey;
  const sighash = decoded.hashForWitnessV1(
    0,
    [stateOutputScript(S0, signer.internalKey)],
    [Number(funding.valueSats)],
    bitcoin.Transaction.SIGHASH_DEFAULT,
  );
  const sigValid = ecc.verifySchnorr(sighash, q0, Buffer.from(witnessSig.subarray(0, 64)));
  console.log(`    key-path Schnorr signature verifies against Q(S0): ${sigValid ? "YES" : "NO"}`);

  console.log("\n" + line);
  console.log(
    "PROOF COMPLETE. Bitcoin enforces the Taproot key-path signature; the Guardian enforces the transition policy.",
  );
}

import { pathToFileURL } from "node:url";
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
