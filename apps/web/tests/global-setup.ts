import { fund, mine, IDENTITIES } from "./v3-rpc";

/**
 * E2E global setup: fund deterministic Alice/Bob/Carol regtest wallets with
 * real BTC, then mine 101 blocks (coinbase maturity). Token creation happens
 * through real Cove transactions in the specs — never seeded rows.
 */
export default async function globalSetup() {
  const wallets = [IDENTITIES.alice, IDENTITIES.bob, IDENTITIES.carol];
  for (const w of wallets) {
    await fund(w.address, 5);
  }
  await mine(101);
}
