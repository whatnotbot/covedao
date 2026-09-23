import { describe, expect, it } from "vitest";
import { decodeRawTransaction, opReturnPayload, outputAddress, btcNetwork } from "./decoder.js";

/**
 * Golden fixtures are REAL, confirmed Bitcoin signet transactions fetched from
 * https://bitcoin-signet-rpc.publicnode.com (chain=signet, tip block 323322).
 * They are embedded here so the decoder is regression-tested against actual
 * chain data with no network dependency.
 */

// signet tx ba7003626c5805e2bea173660e4bcd8dcd14d273fb255531f1f662125871b630
// OP_RETURN "coinbin.org" + 2 P2WPKH outputs (a real Coinbin-style data tx).
const OP_RETURN_TX_HEX =
  "02000000000101b01b0e775b4836bb06446ecd429706ac913e716507e695612e88a69b07d25de30000000000fdffffff0300000000000000000d6a0b636f696e62696e2e6f7267084c0100000000001600142fd904b4bb0fdf73a42931bf00a718bb4260add045bdd52701000000160014ab60470856ed5dcd3ccc46abc1d25e0714001fcd02473044022046f2aeb283aefbebf0307d0a025998910b60b3d9c2104c95d2ebca1735994ae302204a57174f769a2c53c76c4960c3553402c65299a1ddedaf9d35064dc2dea50a8b012102d450fa41f2f7c2b0afcdf6a648d66d0d74d8fdab718c2573beb0f0447b9c732e00000000";

// signet tx 4880a1660588a2612d0271a15028f4894c6120acd32442b094118161d532338f
// single key-path P2TR output (taproot address derivation without an ECC lib).
const P2TR_TX_HEX =
  "02000000000101cd296311c90c9adaa8fe09e85651c6ee74753663cb3e1d85ccc62abfaa52e87b03000000002e0000000193b8be000000000022512065f85d0c6d7a63611fb4ffaed9ac699159bda6cf5c049af46655b92868423a9a09408982118ed5fdab84a594b6b7832c0bcee696570f2c9d239b461eb7c5615eb3c361ce8a1a9de5f7593e4966d6e9272d184411867c933e5e65a8023fe81ce344c72079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798030000000b0000004000001e9d7c4ffb1b614a16cc28f0e6f136a380647d8d2c7a9fbf55f3dc85fcfb27ac9401140122a660947600a2697601409f697601407c94b2750200006b760120a2636c04000000007e6b012094687660a2636c0200007e6b6094687658a2636c01007e6b5894687c825188766b517e020001947c7600876302000167765187630280006776528763014067765387630120677654876360677655876358677656876354675268686868686868779f696c6c7e7e6b708201208875820140887c827c7e7e7c827c7e7c7eaa6c88ac21c14a981eda2acd9bf5d789fa1a9b7f95677776d99fd13ec0f658f0e4dbc5b5c87800000000";

describe("decodeRawTransaction (real signet golden fixtures)", () => {
  it("decodes an OP_RETURN + P2WPKH transaction", () => {
    const tx = decodeRawTransaction(OP_RETURN_TX_HEX);
    expect(tx.txid).toBe("ba7003626c5805e2bea173660e4bcd8dcd14d273fb255531f1f662125871b630");
    expect(tx.version).toBe(2);
    expect(tx.locktime).toBe(0);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0]).toMatchObject({
      prevTxid: "e35dd2079ba6882e6195e60765713e91ac069742cd6e4406bb36485b770e1bb0",
      vout: 0,
    });
    expect(tx.outputs).toHaveLength(3);

    // OP_RETURN output carries the "coinbin.org" payload.
    const [o0, o1, o2] = tx.outputs;
    expect(o0!.valueSats).toBe(0n);
    expect(o0!.scriptPubKeyHex).toBe("6a0b636f696e62696e2e6f7267");
    expect(Buffer.from(o0!.opReturnData!).toString("utf8")).toBe("coinbin.org");

    // P2WPKH outputs derive testnet/signet bech32 addresses.
    expect(o1!.valueSats).toBe(85_000n);
    expect(o1!.address).toBe("tb1q9lvsfd9mpl0h8fpfxxlspfcchdpxptws8kg6fa");
    expect(o2!.valueSats).toBe(4_963_286_341n);
    expect(o2!.address).toBe("tb1q4dsywzzka4wu60xvg64ur5j7qu2qq87dzc6s97");
  });

  it("decodes a key-path P2TR transaction and derives its address", () => {
    const tx = decodeRawTransaction(P2TR_TX_HEX);
    expect(tx.txid).toBe("4880a1660588a2612d0271a15028f4894c6120acd32442b094118161d532338f");
    expect(tx.outputs).toHaveLength(1);
    const [p0] = tx.outputs;
    expect(p0!.valueSats).toBe(12_499_091n);
    expect(p0!.scriptPubKeyHex).toBe(
      "512065f85d0c6d7a63611fb4ffaed9ac699159bda6cf5c049af46655b92868423a9a",
    );
    expect(p0!.address).toBe("tb1pvhu96rrd0f3kz8a5l7hdntrfj9vmmfk0tszf4arx2kujs6zz82dqxflggf");
  });

  it("rejects malformed input", () => {
    expect(() => decodeRawTransaction("")).toThrow();
    expect(() => decodeRawTransaction("not-hex")).toThrow();
    expect(() => decodeRawTransaction("00")).toThrow();
    expect(() => decodeRawTransaction(OP_RETURN_TX_HEX.slice(0, 100))).toThrow();
  });
});

describe("opReturnPayload", () => {
  it("extracts a direct push payload", () => {
    const payload = opReturnPayload(Buffer.from("6a0b636f696e62696e2e6f7267", "hex"));
    expect(Buffer.from(payload!).toString("utf8")).toBe("coinbin.org");
  });

  it("extracts an OP_PUSHDATA1 payload", () => {
    // OP_RETURN + 0x4c + len(2) + 0xdead
    const payload = opReturnPayload(Buffer.from("6a4c02dead", "hex"));
    expect(Buffer.from(payload!).toString("hex")).toBe("dead");
  });

  it("returns undefined for empty or non-OP_RETURN scripts", () => {
    expect(opReturnPayload(Buffer.from("6a", "hex"))).toBeUndefined();
    expect(opReturnPayload(Buffer.from("0014" + "00".repeat(20), "hex"))).toBeUndefined();
  });

  it("never throws on truncated/hostile OP_RETURN pushes (bounds-checked)", () => {
    expect(opReturnPayload(Buffer.from("6a4d", "hex"))).toBeUndefined(); // PUSHDATA2 truncated
    expect(opReturnPayload(Buffer.from("6a4e01", "hex"))).toBeUndefined(); // PUSHDATA4 truncated
    expect(opReturnPayload(Buffer.from("6a4c", "hex"))).toBeUndefined(); // PUSHDATA1 truncated
    expect(opReturnPayload(Buffer.from("6a4effffffffdeadbeef", "hex"))).toBeUndefined(); // declares 4GB, has 4
    expect(opReturnPayload(Buffer.from("6a0b636f", "hex"))).toBeUndefined(); // declares 11, has 2
  });
});

describe("outputAddress / btcNetwork", () => {
  it("derives P2WPKH and P2TR addresses without an ECC library", () => {
    const net = btcNetwork("signet");
    const p2wpkh = Buffer.from("0014" + "ab".repeat(20), "hex");
    expect(outputAddress(p2wpkh, net)?.startsWith("tb1q")).toBe(true);
    const p2tr = Buffer.from("5120" + "cd".repeat(32), "hex");
    expect(outputAddress(p2tr, net)?.startsWith("tb1p")).toBe(true);
  });

  it("maps signet to testnet address params", () => {
    expect(btcNetwork("signet").bech32).toBe("tb");
    expect(btcNetwork("mainnet").bech32).toBe("bc");
  });

  it("throws on an unknown network instead of silently defaulting to testnet", () => {
    expect(() => btcNetwork("bogus" as never)).toThrow(/Unknown Bitcoin network/);
  });
});
