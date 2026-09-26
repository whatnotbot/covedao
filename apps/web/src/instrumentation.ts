/**
 * Runs once when the Next.js server starts.
 *
 * On mainnet the web app and the Guardian must run the same profile, fee
 * address (COVE_FEE_ADDRESS) included: the server stops on a mismatch rather
 * than serve mints and redeems the Guardian or the indexer would reject.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.COVE_NETWORK !== "mainnet") return;
  const { getV3Services } = await import("@/lib/v3-server");
  const { watchGuardianAgreement } = await import("@crclaunch/cove-app");
  const { config, transitionSigner } = getV3Services();
  watchGuardianAgreement(transitionSigner, config, { service: "web" });
}
