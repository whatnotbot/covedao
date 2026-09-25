import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateCanonicalMint } from "../src/mint-validation.js";

interface Vector {
  id: string;
  state: {
    profile: string;
    tickerExists: boolean;
    confirmedSupplyTokens: string;
    publicSupplyTokens: string;
  };
  operation: {
    ticker: string;
    requestedAmountTokens: string;
    paymentSats: string;
    replayed: boolean;
    claimedSupplyBeforeTokens?: string;
  };
  expected: {
    valid: boolean;
    requiredPaymentSats: string | null;
    reason: string | null;
  };
}

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../docs/legacy/CRC_LAUNCH_V1_TEST_VECTORS.json", import.meta.url)), "utf8"),
) as { vectors: Vector[] };

describe("CRC Launch V1 canonical mint test vectors", () => {
  for (const v of vectors.vectors) {
    it(v.id, () => {
      const result = validateCanonicalMint({
        profile: v.state.profile,
        tickerExists: v.state.tickerExists,
        confirmedSupplyTokens: BigInt(v.state.confirmedSupplyTokens),
        requestedAmountTokens: BigInt(v.operation.requestedAmountTokens),
        paymentSats: BigInt(v.operation.paymentSats),
        replayed: v.operation.replayed,
        claimedSupplyBeforeTokens: v.operation.claimedSupplyBeforeTokens
          ? BigInt(v.operation.claimedSupplyBeforeTokens)
          : undefined,
      });
      expect(result.valid, v.id).toBe(v.expected.valid);
      expect(
        result.requiredPaymentSats?.toString() ?? null,
        `${v.id} requiredPayment`,
      ).toBe(v.expected.requiredPaymentSats);
      expect(result.reason, `${v.id} reason`).toBe(v.expected.reason);
    });
  }
});
