/**
 * REAL Bitcoin Core regtest proof of the Cove NUMS/dual-leaf vault recovery
 * (144-block OP_CHECKSEQUENCEVERIFY) leaf.
 *
 *   1. fund + mine a real Cove vault (NUMS internal key, dual-leaf MAST)
 *   2. premature recovery spend (nSequence=144, immature) → testmempoolaccept REJECT
 *   3. mine until the relative delay is satisfied
 *   4. boundary: nSequence=143 (delay−1) → REJECT; nSequence=144 (delay) → ACCEPT
 *   5. broadcast + mine the mature recovery spend
 *   6. decode the witness and prove signature + recovery tapscript + control block
 */
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { CoreRpcProvider } from "@crclaunch/bitcoin";
import { buildCoveVault } from "./vault.js";
import { RECOVERY_CSV_BLOCKS } from "./leaves.js";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";

// Deterministic keys: guardian = priv 0x42, owner = priv 0x43.
const guardianXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));
const ownerKey = ECPair.fromPrivateKey(Buffer.alloc(32, 0x43), {
  network: bitcoin.networks.regtest,
});
const ownerXOnly = Buffer.from(ownerKey.publicKey.subarray(1));
const S1_HASH = Buffer.from(
  "27fb483afe745a89ea8d5f55ecc9401e0a96b15abd2ecb7ea4afb6633482828a",
  "hex",
);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/** Serialize a witness stack as bip174 finalScriptWitness (varint-prefixed items). */
function scriptWitness(items: Buffer[]): Buffer {
  const varInt = (n: number): Buffer => {
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
  const parts: Buffer[] = [varInt(items.length)];
  for (const it of items) parts.push(varInt(it.length), it);
  return Buffer.concat(parts);
}

class RegtestRpc {
  private id = 0;
  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
  ) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    headers.authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: `${++this.id}`, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: { result?: T; error?: { message?: string } | null } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || json.error) {
      throw new Error(
        `RPC ${method}: ${json.error?.message ?? text.slice(0, 200) ?? `HTTP ${res.status}`}`,
      );
    }
    return json.result as T;
  }

  async createWallet(name: string): Promise<void> {
    try {
      await this.call("createwallet", [name, false, false, "", false, false, false]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists/i.test(msg)) throw e;
    }
  }

  async getNewAddress(): Promise<string> {
    return this.call<string>("getnewaddress");
  }

  async sendToAddress(address: string, amountBtc: number): Promise<string> {
    return this.call<string>("sendtoaddress", [address, amountBtc]);
  }

  async generateToAddress(n: number, address: string): Promise<string[]> {
    return this.call<string[]>("generatetoaddress", [n, address]);
  }

  async getBlockchainInfo(): Promise<{ chain: string; blocks: number }> {
    return this.call("getblockchaininfo");
  }
}

function findOutputIndex(tx: bitcoin.Transaction, script: Buffer): number {
  return tx.outs.findIndex((o) => o.script.equals(script));
}

function buildRecoveryPsbt(params: {
  vault: ReturnType<typeof buildCoveVault>;
  txid: string;
  vout: number;
  value: number;
  destScript: Buffer;
  feeSats: number;
  sequence: number;
}) {
  const { vault, txid, vout, value, destScript, feeSats, sequence } = params;
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
  psbt.addInput({
    hash: txid,
    index: vout,
    witnessUtxo: { script: vault.scriptPubKey, value },
    tapInternalKey: vault.numsKey,
    tapLeafScript: [
      {
        leafVersion: 0xc0,
        script: vault.recoveryLeaf.script,
        controlBlock: vault.recoveryControlBlock,
      },
    ],
    sequence,
  });
  psbt.addOutput({ script: destScript, value: value - feeSats });
  return psbt;
}

async function main(): Promise<void> {
  const line = "─".repeat(72);
  const rpc = new RegtestRpc(RPC_URL, RPC_USER, RPC_PASSWORD);
  const info = await rpc.getBlockchainInfo();
  assert(info.chain === "regtest", `chain is ${info.chain}, expected regtest`);
  const provider = new CoreRpcProvider({ url: RPC_URL, user: RPC_USER, password: RPC_PASSWORD });

  const vault = buildCoveVault({ successorStateHash: S1_HASH, guardianXOnly, ownerXOnly });
  console.log(line);
  console.log("COVE NUMS/DUAL-LEAF VAULT — 144-BLOCK CSV RECOVERY PROOF");
  console.log(line);
  console.log(`  NUMS internal key : ${vault.numsKey.toString("hex")}`);
  console.log(`  output key Q      : ${vault.outputKey.toString("hex")}`);
  console.log(`  vault address     : ${vault.address}`);
  console.log(`  merkle root       : ${vault.merkleRoot.toString("hex")}`);

  // 1. Wallet + funds.
  await rpc.createWallet("covevault");
  const walletAddress = await rpc.getNewAddress();
  await rpc.generateToAddress(101, walletAddress);

  // 2. Fund + mine the vault.
  const vaultAddress = bitcoin.address.fromOutputScript(
    vault.scriptPubKey,
    bitcoin.networks.regtest,
  );
  const fundTxid = await rpc.sendToAddress(vaultAddress, 0.001); // 100,000 sats
  await rpc.generateToAddress(1, walletAddress);
  const raw = await provider.getRawTransaction(fundTxid);
  const fundTx = bitcoin.Transaction.fromHex(raw);
  const vaultVout = findOutputIndex(fundTx, vault.scriptPubKey);
  assert(vaultVout >= 0, "vault output not found in funding tx");
  const vaultValue = fundTx.outs[vaultVout]!.value;
  const vaultConfHeight = (await rpc.getBlockchainInfo()).blocks;
  console.log(
    `\n✓ vault funded ${fundTxid}:${vaultVout} value=${vaultValue} (confirmed at height ${vaultConfHeight})`,
  );

  const destScript = bitcoin.address.toOutputScript(walletAddress, bitcoin.networks.regtest);

  // 3. Premature recovery spend (nSequence=144, but vault immature).
  {
    const psbt = buildRecoveryPsbt({
      vault,
      txid: fundTxid,
      vout: vaultVout,
      value: vaultValue,
      destScript,
      feeSats: 1_000,
      sequence: RECOVERY_CSV_BLOCKS,
    });
    psbt.signTaprootInput(0, ownerKey, vault.recoveryLeaf.tapleafHash);
    const sig = psbt.data.inputs[0]!.tapScriptSig![0]!.signature!;
    psbt.updateInput(0, {
      finalScriptWitness: scriptWitness([
        Buffer.from(sig),
        Buffer.alloc(0),
        vault.recoveryLeaf.script,
        vault.recoveryControlBlock,
      ]),
    });
    const hex = psbt.extractTransaction().toHex();
    const accept = await provider.testMempoolAccept(hex);
    console.log(
      `  premature spend  : allowed=${accept.allowed}${accept.rejectReason ? " reject=" + accept.rejectReason : ""}`,
    );
    assert(accept.allowed === false, "premature recovery must be REJECTED");
  }

  // 4. Mine until the relative delay is satisfied (143 more blocks ⇒ vault is 144 deep).
  const target = vaultConfHeight + RECOVERY_CSV_BLOCKS - 1;
  const now = (await rpc.getBlockchainInfo()).blocks;
  await rpc.generateToAddress(target - now, walletAddress);
  console.log(`✓ mined to tip ${target} (vault is ${RECOVERY_CSV_BLOCKS} blocks deep)`);

  // 5. Boundary: delay−1 (nSequence=143) → REJECT.
  {
    const psbt = buildRecoveryPsbt({
      vault,
      txid: fundTxid,
      vout: vaultVout,
      value: vaultValue,
      destScript,
      feeSats: 1_000,
      sequence: RECOVERY_CSV_BLOCKS - 1,
    });
    psbt.signTaprootInput(0, ownerKey, vault.recoveryLeaf.tapleafHash);
    const sig = psbt.data.inputs[0]!.tapScriptSig![0]!.signature!;
    psbt.updateInput(0, {
      finalScriptWitness: scriptWitness([
        Buffer.from(sig),
        Buffer.alloc(0),
        vault.recoveryLeaf.script,
        vault.recoveryControlBlock,
      ]),
    });
    const accept = await provider.testMempoolAccept(psbt.extractTransaction().toHex());
    console.log(
      `  delay−1 (seq=143): allowed=${accept.allowed}${accept.rejectReason ? " reject=" + accept.rejectReason : ""}`,
    );
    assert(accept.allowed === false, "delay−1 (nSequence=143) must be REJECTED");
  }

  // 6. Boundary: delay (nSequence=144) → ACCEPT.
  const maturePsbt = buildRecoveryPsbt({
    vault,
    txid: fundTxid,
    vout: vaultVout,
    value: vaultValue,
    destScript,
    feeSats: 1_000,
    sequence: RECOVERY_CSV_BLOCKS,
  });
  maturePsbt.signTaprootInput(0, ownerKey, vault.recoveryLeaf.tapleafHash);
  const sig = maturePsbt.data.inputs[0]!.tapScriptSig![0]!.signature!;
  maturePsbt.updateInput(0, {
    finalScriptWitness: scriptWitness([
      Buffer.from(sig),
      Buffer.alloc(0),
      vault.recoveryLeaf.script,
      vault.recoveryControlBlock,
    ]),
  });
  const matureHex = maturePsbt.extractTransaction().toHex();
  const matureAccept = await provider.testMempoolAccept(matureHex);
  console.log(
    `  delay (seq=144)  : allowed=${matureAccept.allowed}${matureAccept.rejectReason ? " reject=" + matureAccept.rejectReason : ""}`,
  );
  assert(
    matureAccept.allowed === true,
    `mature recovery must be ACCEPTED: ${matureAccept.rejectReason}`,
  );

  // 7. Broadcast + mine.
  const spendTxid = await provider.broadcastTransaction(matureHex);
  await rpc.generateToAddress(1, walletAddress);
  console.log(`✓ recovery spend mined ${spendTxid}`);

  // 8. Decode the witness and prove the committed spend.
  const spendRaw = await provider.getRawTransaction(spendTxid);
  const spendTx = bitcoin.Transaction.fromHex(spendRaw);
  const witness = spendTx.ins[0]!.witness;
  const [wsig, wpad, wscript, wcontrol] = witness;
  assert(wsig!.length === 64, "recovery witness signature must be 64 bytes");
  assert(
    wscript!.equals(vault.recoveryLeaf.script),
    "revealed script != committed recovery tapscript",
  );
  assert(
    wcontrol!.equals(vault.recoveryControlBlock),
    "control block != committed recovery control block",
  );
  assert(wpad!.length === 0, "OP_2DROP padding item must be empty");
  console.log(`    revealed recovery tapscript : ${wscript!.toString("hex")}`);
  console.log(`    control block               : ${wcontrol!.toString("hex")}`);
  console.log(`    signature (64B)             : ${wsig!.toString("hex").slice(0, 32)}…`);
  console.log(
    `    witness stack size          : ${witness.length} (sig, pad, script, control block)`,
  );

  console.log("\n" + line);
  console.log(
    "CSV PROOF PASSED: premature REJECT, delay−1 REJECT, delay ACCEPT, recovery script-path spend verified",
  );
  console.log(`  vault txid   : ${fundTxid}`);
  console.log(`  spend txid   : ${spendTxid}`);
}

import { pathToFileURL } from "node:url";
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("csv-proof failed:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
