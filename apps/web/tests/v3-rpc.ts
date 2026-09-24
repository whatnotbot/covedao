import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);

const RPC_URL = process.env.COVE_REGTEST_RPC_URL ?? "http://127.0.0.1:18443";
const RPC_USER = process.env.COVE_REGTEST_RPC_USER ?? "user";
const RPC_PASSWORD = process.env.COVE_REGTEST_RPC_PASSWORD ?? "pass";

let id = 0;
export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASSWORD}`).toString("base64")}`,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: `${++id}`, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`RPC ${method}: ${json.error?.message ?? "err"}`);
  return json.result as T;
}

export async function mine(n: number): Promise<void> {
  const addr = await rpc<string>("getnewaddress");
  await rpc("generatetoaddress", [n, addr]);
}

export async function fund(address: string, btc: number): Promise<string> {
  return rpc<string>("sendtoaddress", [address, btc]);
}

/** Non-token-carrier BTC UTXOs for an address (carriers are exactly 1000 sats). */
export async function listBtcUtxos(address: string): Promise<{ txid: string; vout: number }[]> {
  // scantxoutset scans the whole UTXO set for the address (listunspent only
  // sees the node's OWN wallet, which does not track the E2E identities).
  const res = await rpc<{ unspents: { txid: string; vout: number; amount: number }[] }>("scantxoutset", ["start", [{ desc: `addr(${address})` }]]);
  return res.unspents.filter((u) => Math.round(u.amount * 1e8) > 1000).map((u) => ({ txid: u.txid, vout: u.vout }));
}

export function p2wpkhAddress(privHex: string): string {
  const ECPair = ECPairFactory(ecc);
  const key = ECPair.fromPrivateKey(Buffer.from(privHex, "hex"), { network: bitcoin.networks.regtest });
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest }).address!;
}

export const IDENTITIES = {
  alice: { privHex: "46".repeat(32), address: "" },
  bob: { privHex: "47".repeat(32), address: "" },
  carol: { privHex: "48".repeat(32), address: "" },
};
IDENTITIES.alice.address = p2wpkhAddress(IDENTITIES.alice.privHex);
IDENTITIES.bob.address = p2wpkhAddress(IDENTITIES.bob.privHex);
IDENTITIES.carol.address = p2wpkhAddress(IDENTITIES.carol.privHex);
