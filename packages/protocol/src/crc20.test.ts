import { describe, expect, it } from "vitest";
import {
  decodeCrc20Json,
  decodeCrc20OpReturn,
  OBSERVED_LEAF_TRANSFER,
} from "./crc20.js";

/**
 * Regression fixtures based on a REAL, confirmed mainnet CRC-20 transfer.
 * txid e0b7e317a6311432bd3f03e9f8536b4dfed0625ddf5b96f5b1c6bc25bdb8ee2f @ 968,175.
 */
describe("CRC-20 observed transfer format (forensics fixture)", () => {
  it("decodes the real LEAF transfer OP_RETURN payload", () => {
    const payload = decodeCrc20OpReturn(OBSERVED_LEAF_TRANSFER.opReturnHex);
    expect(payload).not.toBeNull();
    expect(payload!.p).toBe("crc-20");
    expect(payload!.op).toBe("transfer");
    expect(payload!.tick).toBe("LEAF");
    expect(payload!.amt).toBe("10000000000000"); // 100,000 LEAF in 8-decimal atoms
  });

  it("rejects non-crc-20 and malformed JSON", () => {
    expect(decodeCrc20Json('{"p":"brc-20","op":"transfer","tick":"ordi"}')).toBeNull();
    expect(decodeCrc20Json("not json")).toBeNull();
    expect(decodeCrc20Json('{"p":"crc-20","op":"transfer"}')).toBeNull(); // missing tick
  });

  it("rejects non-OP_RETURN scriptPubKeys", () => {
    // A P2WPKH output is not OP_RETURN.
    expect(decodeCrc20OpReturn("0014209634cf07d22970e373ad8f27897c49879f0296")).toBeNull();
  });

  it("confirms the live treasury output is a single-key P2TR (no visible covenant)", () => {
    const spk = OBSERVED_LEAF_TRANSFER.treasuryScriptPubKey;
    // OP_1 (0x51) + 0x20 push + 32-byte x-only pubkey == key-path-only Taproot.
    expect(spk.startsWith("5120")).toBe(true);
    expect(Buffer.from(spk.slice(4), "hex").length).toBe(32);
  });
});
