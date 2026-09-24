import { CHAIN_BITCOIN_REGTEST } from "@crclaunch/cove-wire";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { runCli } from "./cli.js";

/**
 * V3 CLI entry (dev/regtest). Reads Core RPC env and runs reindex|verify|status.
 */
const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const guardianXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x42), true)!.subarray(1));
const recoveryXOnly = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x43), true)!.subarray(1));
// deterministic protocol fee destination (priv 0x44, dev)
const feeKey = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x44), true)!.subarray(1));
const feeScript = bitcoin.payments.p2tr({ internalPubkey: feeKey, network: bitcoin.networks.regtest }).output!;

runCli(process.argv.slice(2), {
  network: "regtest",
  chainIdentity: CHAIN_BITCOIN_REGTEST,
  guardianXOnly,
  recoveryKeyXOnly: recoveryXOnly,
  feeScript,
  genesisHeight: 0n,
}, { rpcUrl: RPC_URL, rpcUser: RPC_USER, rpcPassword: RPC_PASSWORD }).catch((e) => {
  console.error("v3 cli failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
