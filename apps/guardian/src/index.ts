import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildGuardianService, type GuardianServiceConfig } from "./service.js";
import { TestGuardianCustodyBackend, UnconfiguredGuardianCustodyBackend } from "@crclaunch/cove-guardian/v3";
import type { GuardianTransport } from "@crclaunch/cove-guardian/v3";

/**
 * Guardian HTTP SERVICE (Phase 8.1 §18-§20). A standalone process — NOT a
 * Next.js route. Only two endpoints: GET /health and POST /sign (MINT/REDEEM).
 * Authenticated with a bearer token (mTLS/operator auth terminates in front of
 * this service in production). No generic sign endpoint.
 */

const PORT = Number(process.env.GUARDIAN_PORT ?? 4391);
const AUTH_TOKEN = process.env.GUARDIAN_AUTH_TOKEN ?? "";
const PROFILE_PATH = process.env.COVE_V3_MAINNET_PROFILE_PATH ?? ".cove-v3-mainnet-profile.json";
const DATABASE_URL = process.env.COVE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const NETWORK = (process.env.GUARDIAN_NETWORK ?? "regtest") as GuardianServiceConfig["network"];

// Custody backend: test backend ONLY when an explicit test key is supplied
// (regtest/integration); otherwise fail closed (production custody not selected).
const TEST_KEY_HEX = process.env.GUARDIAN_TEST_KEY_HEX;
const custodyBackend = TEST_KEY_HEX
  ? new TestGuardianCustodyBackend(Buffer.from(TEST_KEY_HEX, "hex"))
  : new UnconfiguredGuardianCustodyBackend();

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error("COVE_DATABASE_URL is required");
  const built = buildGuardianService({
    profilePath: PROFILE_PATH,
    databaseUrl: DATABASE_URL,
    network: NETWORK,
    custodyBackend,
    riskPolicy: {
      maxGrossSats: BigInt(process.env.GUARDIAN_MAX_GROSS_SATS ?? "1000000"),
      maxRedeemPayoutSats: BigInt(process.env.GUARDIAN_MAX_REDEEM_PAYOUT_SATS ?? "1000000"),
      maxBackingSats: BigInt(process.env.GUARDIAN_MAX_BACKING_SATS ?? "100000000000000"),
      maxMinerFeeSats: BigInt(process.env.GUARDIAN_MAX_MINER_FEE_SATS ?? "20000"),
      allowedTokenIds: process.env.GUARDIAN_CANARY_TOKEN_IDS ? process.env.GUARDIAN_CANARY_TOKEN_IDS.split(",") : null,
    },
    maxMinerFeeSats: BigInt(process.env.GUARDIAN_MAX_MINER_FEE_SATS ?? "20000"),
  });
  const transport: GuardianTransport = built.transport;

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0]!;
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${AUTH_TOKEN}` && AUTH_TOKEN !== "") {
        return json(res, 401, { error: "unauthorized" });
      }

      if (req.method === "GET" && url === "/health") {
        return json(res, 200, await transport.health());
      }
      if (req.method === "POST" && url === "/sign") {
        const body = await readJson(req);
        return json(res, 200, await transport.sign(body as never));
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  server.listen(PORT, () => {
    console.log(`Guardian service listening on :${PORT} (network=${NETWORK}, custody=${TEST_KEY_HEX ? "test" : "unconfigured"})`);
  });
}

main().catch((e) => {
  console.error("guardian service failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
