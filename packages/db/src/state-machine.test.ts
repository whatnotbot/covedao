import { describe, expect, it } from "vitest";
import {
  assertTokenTransition,
  assertTxTransition,
  assertListingTransition,
  InvalidTransitionError,
  TOKEN_STATUS,
} from "../src/index.js";

describe("state machines", () => {
  it("allows valid token transitions", () => {
    expect(() => assertTokenTransition("DRAFT", "DEPLOY_AWAITING_SIGNATURE")).not.toThrow();
    expect(() => assertTokenTransition("LIVE", "SOLD_OUT")).not.toThrow();
    expect(() => assertTokenTransition("SOLD_OUT", "GRADUATING")).not.toThrow();
  });

  it("rejects impossible token transitions (DRAFT -> GRADUATED)", () => {
    expect(() => assertTokenTransition(TOKEN_STATUS.DRAFT, TOKEN_STATUS.GRADUATED)).toThrow(
      InvalidTransitionError,
    );
  });

  it("allows reorg recovery transitions", () => {
    expect(() => assertTokenTransition("GRADUATED", "REORG_RECOVERY")).not.toThrow();
    expect(() => assertTokenTransition("REORG_RECOVERY", "LIVE")).not.toThrow();
  });

  it("rejects invalid tx and listing transitions", () => {
    expect(() => assertTxTransition("FINALIZED", "REJECTED")).toThrow(InvalidTransitionError);
    expect(() => assertListingTransition("TAKEN", "CANCELLED")).toThrow(InvalidTransitionError);
  });
});
