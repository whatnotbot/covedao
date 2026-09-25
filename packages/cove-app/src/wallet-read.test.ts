import { describe, expect, it, vi } from "vitest";
import type { Database } from "@crclaunch/db";

vi.mock("@crclaunch/cove-indexer/v3", () => ({
  getTokenUtxosByScriptDb: async () => [],
  getBalanceByScriptDb: async () => 0n,
}));

import { getWalletPortfolio } from "./wallet-read.js";

function mockDb(): Database {
  return {
    select: () => ({
      from: () => ({ where: async () => [] }),
    }),
  } as unknown as Database;
}

describe("getWalletPortfolio public projection (§M7)", () => {
  it("does not leak off-chain tx sessions for any address", async () => {
    const portfolio = await getWalletPortfolio(mockDb(), "regtest", "0014" + "11".repeat(20));
    expect(portfolio).not.toHaveProperty("sessions");
    expect(Object.keys(portfolio).sort()).toEqual(["fills", "holdings", "listings", "tokenUtxos", "walletScript"]);
  });
});
