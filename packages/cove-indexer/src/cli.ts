import { CoreRpcProvider, decodeRawTransaction, type BitcoinProtocolTx } from "@crclaunch/bitcoin";
import { parseCoveEnvelope } from "@crclaunch/protocol";
import { CoveIndexer } from "./indexer.js";
import { COVE_SIGNET_CONFIG } from "./config.js";

const DEFAULT_RPC_URL = "https://bitcoin-signet-rpc.publicnode.com";

function argValue(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1]!.startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}

function intArg(flag: string, fallback: number): number {
  const v = argValue(flag);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid integer for ${flag}: ${v}`);
  }
  return n;
}

/**
 * A transaction is a Cove candidate only if vout 0 carries an OP_RETURN whose
 * payload parses as a Cove V1 envelope. Non-Cove txs (99.99% of signet) skip
 * prevout resolution entirely, keeping the scan cheap.
 */
function isCoveCandidate(tx: BitcoinProtocolTx): boolean {
  const data = tx.outputs[0]?.opReturnData;
  if (!data) return false;
  return parseCoveEnvelope(data).ok;
}

/** Resolve input 0's spent-UTXO scriptPubKey from the full node. */
async function resolveActor(provider: CoreRpcProvider, tx: BitcoinProtocolTx): Promise<void> {
  const input0 = tx.inputs[0];
  if (!input0 || input0.prevScriptPubKeyHex) return;
  if (input0.prevTxid === "0".repeat(64)) return; // coinbase
  const prevRaw = await provider.getRawTransaction(input0.prevTxid);
  const prev = decodeRawTransaction(prevRaw, "signet");
  const out = prev.outputs[input0.vout];
  if (out) input0.prevScriptPubKeyHex = out.scriptPubKeyHex;
}

async function scanRange(
  provider: CoreRpcProvider,
  from: number,
  to: number,
): Promise<CoveIndexer> {
  const indexer = new CoveIndexer(COVE_SIGNET_CONFIG);
  for (let h = from; h <= to; h++) {
    const hash = await provider.getBlockHash(h);
    const block = await provider.getBlock(hash);
    const txs: BitcoinProtocolTx[] = [];
    for (const raw of block.rawTxs) {
      const tx = decodeRawTransaction(raw, "signet");
      if (isCoveCandidate(tx)) {
        await resolveActor(provider, tx);
      }
      txs.push(tx);
    }
    indexer.processBlock(h, txs);
    process.stderr.write(`  indexed block ${h} (${block.rawTxs.length} txs)\n`);
  }
  return indexer;
}

function printStats(label: string, indexer: CoveIndexer): void {
  const s = indexer.getStats();
  console.log(`\n${label}`);
  console.log(`  blocks        ${s.processedBlocks}`);
  console.log(`  transactions  ${s.processedTxs}`);
  console.log(`  cove txs      ${s.coveTxs}`);
  console.log(`  valid ops     ${s.validOps}`);
  console.log(`  invalid ops   ${s.invalidOps}`);
  console.log(`  tokens        ${s.tokens}`);
  console.log(`  reserve sats  ${s.reserveSats}`);
  console.log(`  treasury sats ${s.treasurySats}`);
  console.log(`  state root    ${s.stateRoot}`);
}

async function cmdIndex(): Promise<void> {
  const provider = new CoreRpcProvider({ url: process.env.COVE_RPC_URL ?? DEFAULT_RPC_URL });
  const tip = await provider.getBestHeight();
  const to = intArg("--to", tip);
  const from = intArg("--from", Math.max(0, to - 4));
  console.log(`Cove index: signet blocks ${from}..${to} (tip ${tip})`);
  const indexer = await scanRange(provider, from, to);
  printStats("Indexed state", indexer);
  const events = indexer.getEvents();
  if (events.length > 0) {
    console.log(`\nCove activity (${events.length} events):`);
    for (const e of events) {
      console.log(
        `  h=${e.blockHeight} ${e.txid} op=${e.operation} valid=${e.valid} reason=${e.reason}`,
      );
    }
  } else {
    console.log("\nNo Cove operations found in the scanned range (protocol is new; expected).");
  }
}

async function cmdVerify(): Promise<void> {
  const provider = new CoreRpcProvider({ url: process.env.COVE_RPC_URL ?? DEFAULT_RPC_URL });
  const tip = await provider.getBestHeight();
  const to = intArg("--to", tip);
  const from = intArg("--from", Math.max(0, to - 4));
  console.log(`Cove verify: independently re-indexing signet blocks ${from}..${to}`);
  const a = await scanRange(provider, from, to);
  const b = await scanRange(provider, from, to);
  const ra = a.getStateRoot();
  const rb = b.getStateRoot();
  console.log(`  run A root ${ra}`);
  console.log(`  run B root ${rb}`);
  if (ra === rb) {
    console.log("  REPLAY-DETERMINISTIC ✓");
  } else {
    console.error("  REPLAY MISMATCH ✗ (determinism violated)");
    process.exitCode = 1;
  }
}

function cmdStatus(): void {
  const empty = new CoveIndexer(COVE_SIGNET_CONFIG);
  console.log("Cove V1 status (Bitcoin signet)");
  console.log(`  protocol            cove`);
  console.log(`  version             1`);
  console.log(`  network             signet`);
  console.log(`  rpc                 ${process.env.COVE_RPC_URL ?? DEFAULT_RPC_URL}`);
  console.log(`  treasury (P2TR)     ${COVE_SIGNET_CONFIG.treasuryScript}  [PLACEHOLDER]`);
  console.log(`  reserve  (P2WPKH)   ${COVE_SIGNET_CONFIG.reserveScript}  [PLACEHOLDER]`);
  console.log(`  launch fee          10,000 sats`);
  console.log(`  primary mint fee    1.00%`);
  console.log(`  empty-state root    ${empty.getStateRoot()}`);
  console.log(`\n  NOTE: treasury/reserve are placeholder scripts for this sprint;`);
  console.log(`        no one holds keys for them. Replace before any deployment.`);
}

const cmd = process.argv[2];
(async () => {
  try {
    if (cmd === "index") await cmdIndex();
    else if (cmd === "verify") await cmdVerify();
    else if (cmd === "status") cmdStatus();
    else {
      console.error("Usage: cove <index|verify|status> [--from N] [--to N]");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Cove CLI error:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
})();
