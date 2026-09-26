import { describe, expect, it } from "vitest";
import { checkRedeemPayout } from "./redeemPayout.js";
import { grossRedeem } from "./backing.js";
import { deterministicFee, COVE_FEE_CONFIG, redeemFeeSats } from "./fee.js";

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

  it("on the live curve a single lot at stair 1 is too small to sell back", () => {
    // One lot (1,000 tokens) at the opening stair is worth 33 sats, under the
    // 1,000-sat floor on the exit fee.
    const gross = grossRedeem(100_000n, 1_000n);
    const c = checkRedeemPayout(gross, redeemFeeSats(gross), P2WPKH);
    expect(gross).toBe(33n);
    expect(c.isPayable).toBe(false);
  });

  it("a whole stair clears the exit fee", () => {
    // 100 lots at 33 sats = 3,300; the 1,000-sat fee floor leaves 2,300.
    const gross = grossRedeem(100_000n, 100_000n);
    const c = checkRedeemPayout(gross, redeemFeeSats(gross), P2WPKH);
    expect(c.netSats).toBe(2_300n);
    expect(c.isPayable).toBe(true);
  });

  it("accepts a sale large enough to clear the fee", () => {
    const gross = grossRedeem(100_000n, 50_000n);
    const fee = deterministicFee(gross, COVE_FEE_CONFIG.redeemFeeBps, COVE_FEE_CONFIG.redeemFeeFlatSats);
    const c = checkRedeemPayout(gross, fee, P2WPKH);
    expect(c.isPayable).toBe(true);
    expect(c.netSats).toBe(gross - fee);
  });
});
