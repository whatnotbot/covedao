import { createServer, type ServerResponse } from "node:http";
import { buildGuardianService } from "./service.js";
import { selectCustodyBackend } from "./custody.js";
import type { GuardianTransport } from "@crclaunch/cove-guardian/v3";
import { requireAuthToken, safeEqual, FixedWindowRateLimiter, readJsonWithLimit } from "./auth.js";

/**
 * Guardian HTTP SERVICE (Phase 8.1 §18-§20). A standalone process — NOT a
 * Next.js route. Only two endpoints: GET /health and POST /sign (MINT/REDEEM).
 * Authenticated with a bearer token; no generic sign endpoint.
 */

const PORT = Number(process.env.GUARDIAN_PORT ?? 4391);
const AUTH_TOKEN = requireAuthToken(process.env.GUARDIAN_AUTH_TOKEN);
const PROFILE_PATH = process.env.COVE_V3_MAINNET_PROFILE_PATH ?? ".cove-v3-mainnet-profile.json";
const DATABASE_URL = process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const NETWORK = (process.env.GUARDIAN_NETWORK ?? "regtest") as "regtest" | "signet" | "testnet" | "mainnet";
const MAX_BODY_BYTES = 1_000_000;

// Custody backend (§C5): the ceremony key file in production; a test key only
// off mainnet; otherwise fail closed. The key file must match the profile's
// guardianXOnly, which buildGuardianService reads — checked again at startup.
const TEST_KEY_HEX = process.env.GUARDIAN_TEST_KEY_HEX;
const KEY_FILE = process.env.GUARDIAN_KEY_FILE;
const custodyBackend = selectCustodyBackend(NETWORK, { testKeyHex: TEST_KEY_HEX, keyFile: KEY_FILE });
const CUSTODY = KEY_FILE ? "key-file" : TEST_KEY_HEX ? "test" : "unconfigured";

// The Guardian's own node (never the app's) and ord.
const CORE_RPC = {
  url: process.env.GUARDIAN_BITCOIN_RPC_URL ?? "",
  user: process.env.GUARDIAN_BITCOIN_RPC_USER,
  password: process.env.GUARDIAN_BITCOIN_RPC_PASSWORD,
};
const ORD_URL = process.env.GUARDIAN_ORD_URL || undefined;
/** What Bitcoin Core calls each network in `getblockchaininfo`. */
const CORE_CHAIN: Record<typeof NETWORK, string> = { mainnet: "main", testnet: "test", signet: "signet", regtest: "regtest" };

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error("COVE_DATABASE_URL is required");
  if (!CORE_RPC.url) throw new Error("GUARDIAN_BITCOIN_RPC_URL is required (the Guardian checks funding inputs against its own node)");
  const built = buildGuardianService({
    profilePath: PROFILE_PATH,
    databaseUrl: DATABASE_URL,
    network: NETWORK,
    custodyBackend,
    coreRpc: CORE_RPC,
    ordUrl: ORD_URL,
  });
  // Refuse to start on the wrong chain, or with a key that is not the profile's.
  const chain = (await built.core.getBlockchainInfo()).chain;
  if (chain !== CORE_CHAIN[NETWORK]) {
    throw new Error(`GUARDIAN_NETWORK is ${NETWORK} but the node is on "${chain}"`);
  }
  if (CUSTODY !== "unconfigured") {
    const key = (await custodyBackend.xOnlyPubkey()).toString("hex");
    if (key !== built.guardianXOnly.toLowerCase()) {
      throw new Error("the custody key is not the profile's guardianXOnly; refusing to start");
    }
  }
  const transport: GuardianTransport = built.transport;
  const limiter = new FixedWindowRateLimiter();

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0]!;
      const auth = req.headers.authorization ?? "";
      if (!safeEqual(auth, `Bearer ${AUTH_TOKEN}`)) {
        return json(res, 401, { error: "unauthorized" });
      }

      const ip = (req.socket.remoteAddress ?? "unknown");
      if (!limiter.allow(ip)) {
        return json(res, 429, { error: "rate limited" });
      }

      if (req.method === "GET" && url === "/health") {
        return json(res, 200, await transport.health());
      }
      if (req.method === "POST" && url === "/sign") {
        const body = await readJsonWithLimit(req, MAX_BODY_BYTES);
        return json(res, 200, await transport.sign(body as never));
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      // §C15: never leak internal error details to the client.
      console.error("guardian request failed:", e instanceof Error ? e.message : String(e));
      return json(res, 500, { error: "internal error" });
    }
  });

  server.listen(PORT, () => {
    console.log(`Guardian service listening on :${PORT} (network=${NETWORK}, custody=${CUSTODY})`);
  });
}

main().catch((e) => {
  console.error("guardian service failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
