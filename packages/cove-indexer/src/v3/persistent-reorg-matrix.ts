import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { createDb, schema } from "@crclaunch/db";
import { eq, and } from "drizzle-orm";
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
import { V3Store } from "./store.js";
import { hydrateState } from "./hydrate.js";
import { persistentWorker, reorgPersistentToTip } from "./persistent.js";
import { getTokenUtxosByScriptDb } from "./read-models-db.js";
import { REGTEST_KEYS, REGTEST_GUARDIAN_PRIV, REGTEST_FEE_SCRIPT, REGTEST_NONCE, REGTEST_MINER_FEE, regtestConfig } from "./testing/regtest-fixture.js";

/**
 * REAL persistent reorg matrix (§14-§23). Uses reorgPersistentToTip (never the
 * in-memory reorg) + hydrateState; after each reorg the DB root must equal an
 * independent clean replay.
 */
bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";
const DB_URL = process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL;
const MINT_AMOUNT = 84_000_000n * 100_000_000n;

function p2wpkh(key: { publicKey: Uint8Array }): Buffer {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey as Buffer, network: bitcoin.networks.regtest }).output!;
}
function p2wpkhAddr(key: { publicKey: Uint8Array }): string {
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey as Buffer, network: bitcoin.networks.regtest }).address!;
}
class Rpc {
  private id = 0;
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers.authorization = `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASSWORD}`).toString("base64")}`;
    const res = await fetch(RPC_URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }), signal: AbortSignal.timeout(30_000) });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (!res.ok || json.error) throw new Error(`RPC ${method}: ${json.error?.message ?? "err"}`);
    return json.result as T;
  }
  getNewAddress = () => this.call<string>("getnewaddress");
  createWallet = async (n: string) => { try { await this.call("createwallet", [n, false, false, "", false, false, false]); } catch (e) { if (!/already exists/i.test((e as Error).message)) throw e; } };
  sendToAddress = (a: string, btc: number) => this.call<string>("sendtoaddress", [a, btc]);
  generate = (n: number, a: string) => this.call<string[]>("generatetoaddress", [n, a]);
  getBestBlockHash = () => this.call<string>("getbestblockhash");
  invalidateBlock = (h: string) => this.call<void>("invalidateblock", [h]);
  abandonTransaction = (txid: string) => this.call<void>("abandontransaction", [txid]);
}
function orThrow(r: ValidatedCoveTransaction | { ok: false; reason: string }): ValidatedCoveTransaction {
  if ("ok" in r) throw new Error(`final validation failed: ${r.reason}`);
  return r;
}

async function main() {
  if (!DB_URL) throw new Error("COVE_DATABASE_URL required (no skip)");
  const rpc = new Rpc();
  const provider = new CoreRpcProvider({ url: RPC_URL, user: RPC_USER, password: RPC_PASSWORD });
  const db = createDb(DB_URL);
  const cfg = regtestConfig();
  const store = new V3Store("regtest");
  await rpc.createWallet("cove53");
  // clear derived V3 projection for an isolated scenario
  await db.transaction(async (tx) => {
    await tx.delete(schema.coveV3Events).where(eq(schema.coveV3Events.network, "regtest"));
    await tx.delete(schema.coveV3Undo).where(eq(schema.coveV3Undo.network, "regtest"));
    await tx.delete(schema.coveV3TokenUtxos).where(eq(schema.coveV3TokenUtxos.network, "regtest"));
    await tx.delete(schema.coveV3BackingStates).where(eq(schema.coveV3BackingStates.network, "regtest"));
    await tx.delete(schema.coveV3Tokens).where(eq(schema.coveV3Tokens.network, "regtest"));
    await tx.delete(schema.coveV3Blocks).where(eq(schema.coveV3Blocks.network, "regtest"));
  });
  const mineAddr = await rpc.getNewAddress();
  await rpc.generate(101, mineAddr);

  let state = new V3IndexerState(cfg);
  const sync = async () => { await persistentWorker({ db, store, state, provider, config: cfg }); };
  const mine = async () => { await rpc.generate(1, mineAddr); await sync(); };
  const broadcast = async (v: ValidatedCoveTransaction) => (await broadcastValidatedCoveTransaction({ validated: v, network: "regtest", provider })).txid;
  const fund = async (key: { publicKey: Uint8Array }, btc: number) => {
    const txid = await rpc.sendToAddress(p2wpkhAddr(key), btc);
    await mine();
    const t = bitcoin.Transaction.fromHex(await provider.getRawTransaction(txid));
    const script = p2wpkh(key);
    const vout = t.outs.findIndex((o) => o.script.equals(script));
    return { txid, vout, script, valueSats: BigInt(t.outs[vout]!.value) };
  };

  const signer = GuardianV3Signer.fromPrivateKey(REGTEST_GUARDIAN_PRIV);
  const gx = signer.xOnlyPubkey();
  const rx = cfg.recoveryKeyXOnly;
  const feeScript = REGTEST_FEE_SCRIPT;
  const alice = REGTEST_KEYS.alice, bob = REGTEST_KEYS.bob, carol = REGTEST_KEYS.carol;

  // base: DEPLOY + MINT
  const deployerUtxo = await fund(REGTEST_KEYS.deployer, 1.0);
  const deploy = buildDeployPsbtV3({ network: bitcoin.networks.regtest, identity: { chainIdentity: cfg.chainIdentity, policyVersion: 3, ticker: "FROG", tokenNonce: REGTEST_NONCE }, guardianXOnly: gx, recoveryKeyXOnly: rx, deployerInputs: [deployerUtxo], deployerChangeScript: deployerUtxo.script, minerFeeSats: REGTEST_MINER_FEE });
  deploy.psbt.signInput(0, REGTEST_KEYS.deployer); deploy.psbt.finalizeAllInputs();
  const deployTxid = await broadcast(orThrow(validateFinalizedDeployTransaction({ rawTxHex: deploy.psbt.extractTransaction().toHex(), network: "regtest", chainIdentity: cfg.chainIdentity, guardianXOnly: gx, recoveryKeyXOnly: rx })));
  await mine();
  const tokenId = deploy.tokenId; const tokenIdHex = tokenId.toString("hex");
  const aliceUtxo = await fund(alice, 1.0);
  const mint1 = buildMintPsbtV3({ network: bitcoin.networks.regtest, tokenId, prevState: deploy.s0, prevBacking: { txid: deployTxid, vout: 1, script: deploy.vault.scriptPubKey, valueSats: RESERVE_ANCHOR_SATS }, mintAmountAtoms: MINT_AMOUNT, guardianXOnly: gx, recoveryKeyXOnly: rx, buyerInputs: [aliceUtxo], buyerCarrierScript: p2wpkh(alice), buyerChangeScript: p2wpkh(alice), feeScript, minerFeeSats: REGTEST_MINER_FEE });
  const ms = validateAndSignMintTransition({ signer, psbt: mint1.psbt, view: state, network: "regtest", recoveryKeyXOnly: rx, feeScript });
  if (!ms.ok) throw new Error("mint refused");
  mint1.psbt.signInput(1, alice); mint1.psbt.finalizeInput(1);
  const mintTxid = await broadcast(orThrow(validateFinalizedMintTransaction({ rawTxHex: mint1.psbt.extractTransaction().toHex(), view: state, network: "regtest", guardianXOnly: gx, recoveryKeyXOnly: rx, feeScript })));
  await mine();

  const rootAfter = (await hydrateState(db, "regtest", cfg)).stateRoot();

  // ── TRANSFER reorg: Alice→Bob then rollback ──
  const aliceFund = await fund(alice, 0.01);
  const transfer = buildTransferPsbtV2({ network: bitcoin.networks.regtest, tokenId, tokenInputs: [{ txid: mintTxid, vout: 2, script: p2wpkh(alice), valueSats: TOKEN_CARRIER_SATS }], tokenInputTotalAtoms: MINT_AMOUNT, tokenOutputs: [{ script: p2wpkh(bob), amountAtoms: MINT_AMOUNT }], funderInputs: [aliceFund], funderChangeScript: p2wpkh(alice), btcOutputs: [], minerFeeSats: REGTEST_MINER_FEE });
  transfer.psbt.signInput(0, alice); transfer.psbt.signInput(1, alice); transfer.psbt.finalizeAllInputs();
  const bobTransferTxid = await broadcast(orThrow(validateFinalizedTransferTransaction({ rawTxHex: transfer.psbt.extractTransaction().toHex(), view: state })));
  await mine();
  const tipA = await rpc.getBestBlockHash();
  await rpc.invalidateBlock(tipA);
  // rollback ONLY (Core tip is now the MINT block); do NOT re-mine yet
  await reorgPersistentToTip({ db, store, state, provider, config: cfg });
  {
    const h = await hydrateState(db, "regtest", cfg);
    const aliceScript = p2wpkh(alice).toString("hex");
    const bobScript = p2wpkh(bob).toString("hex");
    const aliceInv = await getTokenUtxosByScriptDb(db, "regtest", aliceScript);
    const bobInv = await getTokenUtxosByScriptDb(db, "regtest", bobScript);
    if (aliceInv.length !== 1) throw new Error("TRANSFER reorg: Alice inventory not restored");
    if (bobInv.length !== 0) throw new Error("TRANSFER reorg: Bob inventory not removed");
    if (h.stateRoot() !== rootAfter) throw new Error(`TRANSFER reorg root mismatch: ${h.stateRoot()} != ${rootAfter}`);
  }
  console.log(`✓ TRANSFER reorg rollback (Alice restored, Bob removed)`);

  // ── conflicting transfer: abandon Bob, then Alice→Carol ──
  await rpc.abandonTransaction(bobTransferTxid);
  const transfer2 = buildTransferPsbtV2({ network: bitcoin.networks.regtest, tokenId, tokenInputs: [{ txid: mintTxid, vout: 2, script: p2wpkh(alice), valueSats: TOKEN_CARRIER_SATS }], tokenInputTotalAtoms: MINT_AMOUNT, tokenOutputs: [{ script: p2wpkh(carol), amountAtoms: MINT_AMOUNT }], funderInputs: [await fund(alice, 0.01)], funderChangeScript: p2wpkh(alice), btcOutputs: [], minerFeeSats: REGTEST_MINER_FEE });
  transfer2.psbt.signInput(0, alice); transfer2.psbt.signInput(1, alice); transfer2.psbt.finalizeAllInputs();
  const transfer2Txid = await broadcast(orThrow(validateFinalizedTransferTransaction({ rawTxHex: transfer2.psbt.extractTransaction().toHex(), view: state })));
  await mine();
  {
    const h = await hydrateState(db, "regtest", cfg);
    const aliceScript = p2wpkh(alice).toString("hex");
    const bobScript = p2wpkh(bob).toString("hex");
    const carolScript = p2wpkh(carol).toString("hex");
    const spent = await db.select().from(schema.coveV3TokenUtxos).where(and(eq(schema.coveV3TokenUtxos.network, "regtest"), eq(schema.coveV3TokenUtxos.txid, mintTxid), eq(schema.coveV3TokenUtxos.vout, 2)));
    if (spent[0]!.spentByTxid !== transfer2Txid) throw new Error("conflicting transfer spentByTxid wrong");
    if ((await getTokenUtxosByScriptDb(db, "regtest", bobScript)).length !== 0) throw new Error("Bob still owns after conflict");
    if ((await getTokenUtxosByScriptDb(db, "regtest", carolScript)).length !== 1) throw new Error("Carol missing after conflict");
    if ((await getTokenUtxosByScriptDb(db, "regtest", aliceScript)).length !== 0) throw new Error("Alice still owns after conflict");
    void h;
  }
  console.log(`✓ conflicting transfer (Alice→Carol only; X.spentByTxid == ${transfer2Txid.slice(0, 16)}…)`);

  // ── REDEEM reorg ──
  const redeem = buildRedeemPsbtV3({ network: bitcoin.networks.regtest, tokenId, prevState: mint1.nextState, prevBacking: { txid: mintTxid, vout: 1, script: mint1.nextVault.scriptPubKey, valueSats: RESERVE_ANCHOR_SATS + mint1.nextState.backingSats }, redeemAmountAtoms: MINT_AMOUNT, tokenInputs: [{ txid: transfer2Txid, vout: 1, script: p2wpkh(carol), valueSats: TOKEN_CARRIER_SATS }], tokenInputTotalAtoms: MINT_AMOUNT, guardianXOnly: gx, recoveryKeyXOnly: rx, sellerPayoutScript: p2wpkh(carol), sellerChangeScript: p2wpkh(carol), feeScript, minerFeeSats: REGTEST_MINER_FEE });
  const rs = validateAndSignRedeemTransition({ signer, psbt: redeem.psbt, view: state, network: "regtest", recoveryKeyXOnly: rx, feeScript });
  if (!rs.ok) throw new Error("redeem refused");
  redeem.psbt.signInput(1, carol); redeem.psbt.finalizeInput(1);
  const redeemTxid = await broadcast(orThrow(validateFinalizedRedeemTransaction({ rawTxHex: redeem.psbt.extractTransaction().toHex(), view: state, network: "regtest", guardianXOnly: gx, recoveryKeyXOnly: rx, feeScript })));
  await mine();
  const tipR = await rpc.getBestBlockHash();
  await rpc.invalidateBlock(tipR);
  await rpc.generate(1, await rpc.getNewAddress());
  await reorgPersistentToTip({ db, store, state, provider, config: cfg });
  {
    const h = await hydrateState(db, "regtest", cfg);
    if (h.backing.get(tokenIdHex)!.state.backingSats !== 49_350n) throw new Error("REDEEM reorg: backing not restored");
    void redeemTxid;
  }
  console.log(`✓ REDEEM reorg rollback (backing/supply restored)`);

  // ── restart: discard memory, hydrate, continue ──
  state = await hydrateState(db, "regtest", cfg);
  await sync();
  const finalRoot = (await hydrateState(db, "regtest", cfg)).stateRoot();
  const clean = new V3IndexerState(cfg);
  for (let h = 1n; h <= state.cursor.height; h++) {
    const hash = await provider.getBlockHash(Number(h));
    const blk = await provider.getBlock(hash);
    clean.applyBlock({ height: h, hash: blk.hash, parentHash: blk.previousBlockHash, txs: blk.rawTxs });
  }
  if (finalRoot !== clean.stateRoot()) throw new Error(`final DB root ${finalRoot} != clean replay ${clean.stateRoot()}`);
  console.log(`✓ restart + hydrate: DB root == clean replay root ${finalRoot}`);
  console.log("PERSISTENT REORG MATRIX PASSED");
}


main().catch((e) => { console.error("persistent-reorg-matrix failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
