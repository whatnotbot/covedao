import type { FundingInputChecker } from "./funding.js";

/**
 * TESTS ONLY: a funding checker that treats every input as confirmed and
 * token-free, for offline fixtures that have no chain to ask. Not exported
 * from the package; production code builds `chainFundingChecker`.
 */
export const CONFIRMED_FUNDING_FOR_TESTS: FundingInputChecker = {
  async check() {
    return { ok: true };
  },
};
