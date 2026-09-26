import { watchGuardianAgreement } from "@crclaunch/cove-app";
import { getV3Services } from "@/lib/v3-server";

/**
 * Node-runtime startup (imported by instrumentation.ts).
 *
 * On mainnet the web app and the Guardian must run the same profile, fee
 * address (COVE_FEE_ADDRESS) included: the server stops on a mismatch rather
 * than serve mints and redeems the Guardian or the indexer would reject.
 */
if (process.env.COVE_NETWORK === "mainnet") {
  const { config, transitionSigner } = getV3Services();
  watchGuardianAgreement(transitionSigner, config, { service: "web" });
}
