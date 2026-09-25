import { describe, expect, it } from "vitest";
import { checkRedeemPayout } from "./redeemPayout.js";
import { grossRedeem } from "./backing.js";
import { deterministicFee, COVE_FEE_CONFIG } from "./fee.js";

const P2WPKH = Buffer.from("0014" + "cc".repeat(20), "hex");
const P2TR = Buffer.from("5120" + "cc".repeat(32), "hex");

describe("checkRedeemPayout", () => {
  it("refuses a sale worth less than the flat exit fee", () => {
    const c = checkRedeemPayout(500n, 2_500n, P2WPKH);
    expect(c.netSats).toBe(-2_000n);
    expect(c.isPayable).toBe(false);
    expect(c.minimumGrossSats).toBe(2_794n);
  });

  it("refuses a payout that is positive but below relay dust", () => {
    const c = checkRedeemPayout(2_600n, 2_500n, P2WPKH);
    expect(c.netSats).toBe(100n);
    expect(c.isPayable).toBe(false);
  });

  it("accepts a payout exactly at the dust threshold", () => {
    const c = checkRedeemPayout(2_794n, 2_500n, P2WPKH);
    expect(c.netSats).toBe(294n);
    expect(c.isPayable).toBe(true);
  });

  it("uses the payout script's own dust threshold, not a fixed number", () => {
    expect(checkRedeemPayout(2_800n, 2_500n, P2TR).isPayable).toBe(false); // P2TR dust is 330
    expect(checkRedeemPayout(2_830n, 2_500n, P2TR).isPayable).toBe(true);
  });

  it("is the real floor on the live curve: small sales at stage 1 are refused", () => {
    // 1,000,000 tokens at the opening stage is worth 500 sats — a fifth of the
    // exit fee. This is the case that used to reach the PSBT builder and fail
    // with a negative output value.
    const gross = grossRedeem(50_000_000n, 1_000_000n);
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.redeemFeeBps, COVE_FEE_CONFIG.redeemFeeFlatSats);
    const c = checkRedeemPayout(gross, fee, P2WPKH);
    expect(c.netSats).toBeLessThan(0n);
    expect(c.isPayable).toBe(false);
  });

  it("accepts a sale large enough to clear the fee", () => {
    const gross = grossRedeem(50_000_000n, 20_000_000n);
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.redeemFeeBps, COVE_FEE_CONFIG.redeemFeeFlatSats);
    const c = checkRedeemPayout(gross, fee, P2WPKH);
    expect(c.isPayable).toBe(true);
    expect(c.netSats).toBe(gross - fee);
  });
});
