import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { CHAIN_BITCOIN_REGTEST } from "@crclaunch/cove-wire";
import { TOKEN_CARRIER_SATS } from "@crclaunch/cove-covenant";
import {
  GuardianV3Signer,
  buildDeployPsbtV3,
  buildMintPsbtV3,
  buildRedeemPsbtV3,
  buildTransferPsbtV2,
  broadcastValidatedCoveTransaction,
  validateAndSignMintTransition,
  validateAndSignRedeemTransition,
  validateFinalizedDeployTransaction,
  validateFinalizedMintTransaction,
  validateFinalizedRedeemTransaction,
  validateFinalizedTransferTransaction,
  RESERVE_ANCHOR_SATS,
  type ValidatedCoveTransaction,
} from "@crclaunch/cove-guardian/v3";
import { V3IndexerState } from "./state.js";
import { reorgToTip } from "./reorg.js";

/**
 * Phase 4.4 lifecycle → V3 indexer fixture (§28). Indexes REAL mined blocks
 * into V3IndexerState, asserts state, then performs a real reorg and asserts
 * rollback/replay equality.
 */
bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";

const signer = GuardianV3Signer.fromPrivateKey(Buffer.alloc(32, 0x42));
const guardianXOnly = signer.xOnlyPubkey();
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
const NONCE = Buffer.alloc(32, 0xab);
const MINT_AMOUNT = 84_000_000n * 100_000_000n;
const MINER_FEE = 1_000n;

type K = ReturnType<typeof ECPair.makeRandom>;
function p2wpkh(key: K): Buffer {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest }).output!;
}
function p2wpkhAddr(key: K): string {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest }).address!;
}

class Rpc {
  private id = 0;
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers.authorization = `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASSWORD}`).toString("base64")}`;
    const res = await fetch(RPC_URL, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (!res.ok || json.error) throw new Error(`RPC ${method}: ${json.error?.message ?? "err"}`);
    return json.result as T;
  }
  getNewAddress = () => this.call<string>("getnewaddress");
  createWallet = async (n: string) => {
    try { await this.call("createwallet", [n, false, false, "", false, false, false]); }
    catch (e) { if (!/already exists/i.test((e as Error).message)) throw e; }
  };
  sendToAddress = (a: string, btc: number) => this.call<string>("sendtoaddress", [a, btc]);
  generate = (n: number, a: string) => this.call<string[]>("generatetoaddress", [n, a]);
  getBestBlockHash = () => this.call<string>("getbestblockhash");
  invalidateBlock = (h: string) => this.call<void>("invalidateblock", [h]);
}

async function main() {
  const rpc = new Rpc();
  const provider = new CoreRpcProvider({ url: RPC_URL, user: RPC_USER, password: RPC_PASSWORD });
  await rpc.createWallet("cove5");
  const mineAddr = await rpc.getNewAddress();
  await rpc.generate(101, mineAddr);

  const feeKey = ECPair.makeRandom({ network: bitcoin.networks.regtest });
  const feeScript = p2wpkh(feeKey);
  const config = { network: "regtest" as const, chainIdentity: CHAIN_BITCOIN_REGTEST, guardianXOnly, recoveryKeyXOnly: recoveryXOnly, feeScript, genesisHeight: 0n };
  const state = new V3IndexerState(config);

  async function mineIndex(): Promise<void> {
    await rpc.generate(1, mineAddr);
    const hash = await rpc.getBestBlockHash();
    const block = await provider.getBlock(hash);
    state.applyBlock({ height: BigInt(block.height), hash: block.hash, parentHash: block.previousBlockHash, txs: block.rawTxs });
  }
  async function broadcastValidated(validated: ValidatedCoveTransaction): Promise<string> {
    return (await broadcastValidatedCoveTransaction({ validated, network: "regtest", provider })).txid;
  }
  function orThrow(r: ValidatedCoveTransaction | { ok: false; reason: string }): ValidatedCoveTransaction {
    if ("ok" in r) throw new Error(`final validation failed: ${r.reason}`);
    return r;
  }
  async function fund(key: K, btc: number) {
    const addr = p2wpkhAddr(key);
    const txid = await rpc.sendToAddress(addr, btc);
    await rpc.generate(1, mineAddr);
    const raw = await provider.getRawTransaction(txid);
    const t = bitcoin.Transaction.fromHex(raw);
    const script = p2wpkh(key);
    const vout = t.outs.findIndex((o) => o.script.equals(script));
    return { txid, vout, script, valueSats: BigInt(t.outs[vout]!.value) };
  }

  const deployer = ECPair.makeRandom({ network: bitcoin.networks.regtest });
  const alice = ECPair.makeRandom({ network: bitcoin.networks.regtest });
  const bob = ECPair.makeRandom({ network: bitcoin.networks.regtest });

  // ── DEPLOY ──
  const deployerUtxo = await fund(deployer, 1.0);
  const deploy = buildDeployPsbtV3({
    network: bitcoin.networks.regtest,
    identity: { chainIdentity: CHAIN_BITCOIN_REGTEST, policyVersion: 3, ticker: "FROG", tokenNonce: NONCE },
    guardianXOnly, recoveryKeyXOnly: recoveryXOnly,
    deployerInputs: [deployerUtxo], deployerChangeScript: deployerUtxo.script, minerFeeSats: MINER_FEE,
  });
  deploy.psbt.signInput(0, deployer);
  deploy.psbt.finalizeAllInputs();
  const deployHex = deploy.psbt.extractTransaction().toHex();
  const deployVal = orThrow(validateFinalizedDeployTransaction({ rawTxHex: deployHex, network: "regtest", chainIdentity: CHAIN_BITCOIN_REGTEST, guardianXOnly, recoveryKeyXOnly: recoveryXOnly }));
  await broadcastValidated(deployVal);
  await mineIndex();
  const tokenId = deploy.tokenId;
  console.log(`✓ DEPLOY indexed supply=0 backing=0`);

  // ── MINT 84M ──
  const aliceUtxo = await fund(alice, 1.0);
  const mint1 = buildMintPsbtV3({
    network: bitcoin.networks.regtest, tokenId, prevState: deploy.s0,
    prevBacking: { txid: deployVal.txid, vout: 1, script: deploy.vault.scriptPubKey, valueSats: RESERVE_ANCHOR_SATS },
    mintAmountAtoms: MINT_AMOUNT, guardianXOnly, recoveryKeyXOnly: recoveryXOnly,
    buyerInputs: [aliceUtxo], buyerCarrierScript: p2wpkh(alice), buyerChangeScript: p2wpkh(alice), feeScript, minerFeeSats: MINER_FEE,
  });
  const mintSign = validateAndSignMintTransition({ signer, psbt: mint1.psbt, view: state, network: "regtest", recoveryKeyXOnly: recoveryXOnly, feeScript });
  if (!mintSign.ok) throw new Error(`guardian refused MINT: ${mintSign.reason}`);
  mint1.psbt.signInput(1, alice);
  mint1.psbt.finalizeInput(1);
  const mintHex = mint1.psbt.extractTransaction().toHex();
  const mintVal = orThrow(validateFinalizedMintTransaction({ rawTxHex: mintHex, view: state, network: "regtest", guardianXOnly, recoveryKeyXOnly: recoveryXOnly, feeScript }));
  await broadcastValidated(mintVal);
  await mineIndex();
  console.log(`✓ MINT indexed supply=${state.backing.get(tokenId.toString("hex"))!.state.issuedPublicSupplyAtoms} backing=${state.backing.get(tokenId.toString("hex"))!.state.backingSats}`);

  // ── TRANSFER full 84M → Bob ──
  const aliceFund = await fund(alice, 0.01);
  const transfer = buildTransferPsbtV2({
    network: bitcoin.networks.regtest, tokenId,
    tokenInputs: [{ txid: mintVal.txid, vout: 2, script: p2wpkh(alice), valueSats: TOKEN_CARRIER_SATS }],
    tokenInputTotalAtoms: MINT_AMOUNT,
    tokenOutputs: [{ script: p2wpkh(bob), amountAtoms: MINT_AMOUNT }],
    funderInputs: [aliceFund],
    funderChangeScript: p2wpkh(alice), btcOutputs: [], minerFeeSats: MINER_FEE,
  });
  transfer.psbt.signInput(0, alice);
  transfer.psbt.signInput(1, alice);
  transfer.psbt.finalizeAllInputs();
  const transferHex = transfer.psbt.extractTransaction().toHex();
  const transferVal = orThrow(validateFinalizedTransferTransaction({ rawTxHex: transferHex, view: state }));
  await broadcastValidated(transferVal);
  await mineIndex();
  console.log(`✓ TRANSFER indexed (backing/supply unchanged)`);

  // ── REDEEM full 84M ──
  const redeem = buildRedeemPsbtV3({
    network: bitcoin.networks.regtest, tokenId, prevState: mint1.nextState,
    prevBacking: { txid: mintVal.txid, vout: 1, script: mint1.nextVault.scriptPubKey, valueSats: RESERVE_ANCHOR_SATS + mint1.nextState.backingSats },
    redeemAmountAtoms: MINT_AMOUNT,
    tokenInputs: [{ txid: transferVal.txid, vout: 1, script: p2wpkh(bob), valueSats: TOKEN_CARRIER_SATS }],
    tokenInputTotalAtoms: MINT_AMOUNT, guardianXOnly, recoveryKeyXOnly: recoveryXOnly,
    sellerPayoutScript: p2wpkh(bob), sellerChangeScript: p2wpkh(bob), feeScript, minerFeeSats: MINER_FEE,
  });
  const redeemSign = validateAndSignRedeemTransition({ signer, psbt: redeem.psbt, view: state, network: "regtest", recoveryKeyXOnly: recoveryXOnly, feeScript });
  if (!redeemSign.ok) throw new Error(`guardian refused REDEEM: ${redeemSign.reason}`);
  redeem.psbt.signInput(1, bob);
  redeem.psbt.finalizeInput(1);
  const redeemHex = redeem.psbt.extractTransaction().toHex();
  const redeemVal = orThrow(validateFinalizedRedeemTransaction({ rawTxHex: redeemHex, view: state, network: "regtest", guardianXOnly, recoveryKeyXOnly: recoveryXOnly, feeScript }));
  await broadcastValidated(redeemVal);
  await mineIndex();
  console.log(`✓ REDEEM indexed supply=0 backing=0 tokenUtxos=${state.tokenUtxos.size}`);

  const finalRoot = state.stateRoot();
  if (state.backing.get(tokenId.toString("hex"))!.state.backingSats !== 0n) throw new Error("backing not 0 after full redeem");
  console.log(`✓ final root: ${finalRoot}`);

  // ── reorg ──
  const tipBefore = await rpc.getBestBlockHash();
  await rpc.invalidateBlock(tipBefore);
  await rpc.generate(1, await rpc.getNewAddress());
  const report = await reorgToTip(state, provider, config);
  console.log(`✓ reorg: ancestor=${report.commonAncestor} orphaned=[${report.orphanedBlocks.join(",")}] replayed=[${report.replayedBlocks.join(",")}]`);
  console.log(`✓ reorg final root: ${report.finalRoot}`);
  if (report.finalRoot !== finalRoot) throw new Error(`reorg root mismatch: ${report.finalRoot} != ${finalRoot}`);

  console.log("COVE V3 LIFECYCLE INDEXING PASSED");
}

main().catch((e) => {
  console.error("v3-lifecycle-index failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
