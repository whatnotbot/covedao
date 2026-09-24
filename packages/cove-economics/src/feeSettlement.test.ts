import { describe, expect, it } from "vitest";
import { checkFeeSettlement } from "./feeSettlement.js";

const P2WPKH = Buffer.from("0014" + "ab".repeat(20), "hex"); // 22 bytes, dust 294
const P2TR = Buffer.from("5120" + "cd".repeat(32), "hex"); // 34 bytes, dust 330

describe("checkFeeSettlement (explicit protocol-fee dust, §19)", () => {
  it("P2WPKH dust threshold is 294 sats", () => {
    const c = checkFeeSettlement(1n, P2WPKH, 100n);
    expect(c.dustThresholdSats).toBe(294n);
  });

  it("P2TR dust threshold is 330 sats", () => {
    const c = checkFeeSettlement(1n, P2TR, 100n);
    expect(c.dustThresholdSats).toBe(330n);
  });

  it("nonzero sub-dust fee is non-standard (PROTOCOL_FEE_DUST condition)", () => {
    // 1% fee on a 21,000-sat gross = 210 sats < 294 (P2WPKH).
    const c = checkFeeSettlement(210n, P2WPKH, 100n);
    expect(c.isStandard).toBe(false);
    expect(c.minimumGrossForStandardFeeOutput).toBe(29_301n);
  });

  it("a fee at/above dust is standard", () => {
    expect(checkFeeSettlement(294n, P2WPKH, 100n).isStandard).toBe(true);
    expect(checkFeeSettlement(494n, P2WPKH, 100n).isStandard).toBe(true);
  });

  it("zero fee is standard (no fee output needed)", () => {
    expect(checkFeeSettlement(0n, P2WPKH, 100n).isStandard).toBe(true);
  });

  it("minimum gross for standard P2WPKH fee at 100bps is 29,301", () => {
    const c = checkFeeSettlement(210n, P2WPKH, 100n);
    expect(c.minimumGrossForStandardFeeOutput).toBe(29_301n);
  });

  it("minimum gross for standard P2TR fee at 100bps is 33,001", () => {
    const c = checkFeeSettlement(210n, P2TR, 100n);
    // dust 330 → min gross = (330-1)*10000/100 + 1 = 32,901.
    expect(c.minimumGrossForStandardFeeOutput).toBe(32_901n);
  });

  it("zero feeBps → null minimum gross (no fee ever)", () => {
    const c = checkFeeSettlement(1n, P2WPKH, 0n);
    expect(c.minimumGrossForStandardFeeOutput).toBeNull();
  });
});
