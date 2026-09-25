import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { OP_MINT } from "./opcodes.js";
import { encodeDiscovery, discoveryAgreesWithBinary } from "./discovery.js";
import { encodeMintV2, decodeV2 } from "./codecV2.js";
import type { ParsedEnvelopeV2 } from "./codecV2.js";

/**
 * Relay proof for the dual-envelope layout (§D1), executed against a real
 * Bitcoin Core node when COVE_RELAY_RPC_URL is set; skipped otherwise.
 *
 * WHY THIS EXISTS: a transaction carrying two OP_RETURN outputs is rejected as
 * `multi-op-return` by Bitcoin Core <= 29 and accepted by >= 30, which relaxed
 * the datacarrier policy. That is a policy boundary we do not control, so it is
 * measured on a live node rather than assumed. If this test fails on the CI
 * node, the discovery envelope must stay disabled for that deployment.
 *
 *   COVE_RELAY_RPC_URL=http://127.0.0.1:18556 \
 *   COVE_RELAY_RPC_AUTH=u:p \
 *   pnpm --filter @crclaunch/cove-wire test
 */

const RPC_URL = process.env.COVE_RELAY_RPC_URL ?? "";
const RPC_AUTH = process.env.COVE_RELAY_RPC_AUTH ?? "u:p";

const WALLET = "coverelayprobe";

async function rpc(method: string, params: unknown[] = [], wallet = false): Promise<unknown> {
  const url = wallet ? `${RPC_URL.replace(/\/$/, "")}/wallet/${WALLET}` : RPC_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(RPC_AUTH).toString("base64"),
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "relay", method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/** Minimal raw-transaction builder — avoids pulling bitcoinjs into the wire package. */
function buildRawTx(
  input: { txid: string; vout: number },
  outputs: { script: Buffer; value: bigint }[],
): string {
  const parts: Buffer[] = [];
  parts.push(Buffer.from("02000000", "hex")); // version 2
  parts.push(Buffer.from([1])); // 1 input
  parts.push(Buffer.from(input.txid, "hex").reverse());
  const vout = Buffer.alloc(4);
  vout.writeUInt32LE(input.vout);
  parts.push(vout);
  parts.push(Buffer.from([0])); // empty scriptSig
  parts.push(Buffer.from("fdffffff", "hex")); // sequence (RBF)
  parts.push(Buffer.from([outputs.length]));
  for (const o of outputs) {
    const v = Buffer.alloc(8);
    v.writeBigUInt64LE(o.value);
    parts.push(v, Buffer.from([o.script.length]), o.script);
  }
  parts.push(Buffer.from("00000000", "hex")); // locktime
  return Buffer.concat(parts).toString("hex");
}

const opReturnScript = (payload: Buffer) =>
  Buffer.concat([Buffer.from([0x6a, payload.length]), payload]);

describe.skipIf(!RPC_URL)("dual-envelope relay against real Bitcoin Core (§D1)", () => {
  it("a transaction carrying BOTH the binary and crc-20 envelopes relays and mines", async () => {
    const info = (await rpc("getnetworkinfo")) as { subversion: string };

    try {
      await rpc("createwallet", [WALLET]);
    } catch {
      try {
        await rpc("loadwallet", [WALLET]);
      } catch {
        /* already loaded */
      }
    }
    const addr = (await rpc("getnewaddress", [], true)) as string;
    let utxos = (await rpc("listunspent", [], true)) as { txid: string; vout: number; amount: number }[];
    if (utxos.length === 0) {
      await rpc("generatetoaddress", [101, addr]);
      utxos = (await rpc("listunspent", [], true)) as typeof utxos;
    }
    const u = utxos[0]!;

    const tokenId = Buffer.alloc(32, 0xab);
    const binaryPayload = encodeMintV2({ tokenId, amount: 1_000_000n, recipientVout: 1 });
    const binary = decodeV2(binaryPayload) as ParsedEnvelopeV2;
    const discoveryPayload = encodeDiscovery(binary, "FROG");

    // Sanity: the discovery payload must be the canonical one for this binary message.
    expect(discoveryAgreesWithBinary(discoveryPayload, binary, "FROG")).toBe(true);
    expect(binary.op).toBe(OP_MINT);

    const payScript = Buffer.from(
      ((await rpc("getaddressinfo", [addr], true)) as { scriptPubKey: string }).scriptPubKey,
      "hex",
    );
    const raw = buildRawTx({ txid: u.txid, vout: u.vout }, [
      { script: opReturnScript(binaryPayload), value: 0n }, // vout 0 — AUTHORITY
      { script: payScript, value: BigInt(Math.round(u.amount * 1e8)) - 10_000n },
      { script: opReturnScript(discoveryPayload), value: 0n }, // last — DISCOVERY
    ]);

    const signed = (await rpc("signrawtransactionwithwallet", [raw], true)) as {
      hex: string;
      complete: boolean;
    };
    expect(signed.complete).toBe(true);

    const [accept] = (await rpc("testmempoolaccept", [[signed.hex]])) as {
      allowed: boolean;
      "reject-reason"?: string;
    }[];
    expect(
      accept!.allowed,
      `Core ${info.subversion} rejected the dual envelope: ${accept!["reject-reason"] ?? ""}. ` +
        "Core <= 29 rejects multi-op-return; the discovery envelope needs Core >= 30.",
    ).toBe(true);

    const txid = (await rpc("sendrawtransaction", [signed.hex])) as string;
    await rpc("generatetoaddress", [1, addr]);
    const mined = (await rpc("getrawtransaction", [txid, true])) as {
      confirmations: number;
      vout: { scriptPubKey: { type: string; hex: string } }[];
    };

    expect(mined.confirmations).toBeGreaterThanOrEqual(1);

    const nulldata = mined.vout.filter((o) => o.scriptPubKey.type === "nulldata");
    expect(nulldata).toHaveLength(2);

    // vout 0 carries the authoritative binary envelope; the last carries the JSON.
    expect(mined.vout[0]!.scriptPubKey.hex).toBe(opReturnScript(binaryPayload).toString("hex"));
    const last = mined.vout[mined.vout.length - 1]!;
    expect(Buffer.from(last.scriptPubKey.hex, "hex").subarray(2).toString("utf8")).toContain(
      '"p":"crc-20"',
    );
  }, 120_000);
});
