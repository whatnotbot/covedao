import { fund, mine, IDENTITIES } from "./v3-rpc";

/**
 * E2E global setup: mine 101 blocks into the test wallet (coinbase maturity),
 * then fund deterministic Alice/Bob/Carol regtest wallets with real BTC and
 * confirm those funding txs. Token creation happens through real Cove
 * transactions in the specs — never seeded rows.
 */
export default async function globalSetup() {
  await mine(101);
  const wallets = [IDENTITIES.alice, IDENTITIES.bob, IDENTITIES.carol];
  for (const w of wallets) {
    await fund(w.address, 5);
  }
  await mine(1);
}
