/**
 * Mock Canonical CRC Service.
 *
 * This is NOT the real CRC canonical service. It implements the API surface we
 * want the CRC team to provide, backed by the crc-launch-v1 curve engine, so we
 * can (1) prove our integration contract and (2) give CRC developers a concrete
 * shape to respond to. See docs/openapi/crc-canonical-api.yaml.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  STAGE_PRICES_SATS_PER_MILLION,
  STAGE_COUNT,
  getStageForSupply,
  quoteExactTokens,
  getRemainingPublicSupply,
  TOTAL_SUPPLY_ATOMS,
  PUBLIC_SUPPLY_ATOMS,
} from "@crclaunch/curve";

const PORT = Number(process.env.PORT ?? 4390);
const DECIMALS = 8;
const ONE = 10n ** BigInt(DECIMALS);
const MAX_ATOMS = TOTAL_SUPPLY_ATOMS * ONE;

interface Token {
  deploymentId: string;
  ticker: string;
  profile: string;
  confirmedMintedAtoms: bigint; // 8dp
  status: "LIVE" | "SOLD_OUT" | "GRADUATED";
}

interface Operation {
  id: string;
  kind: string;
  status: "pending" | "accepted" | "rejected" | "finalized";
  reason?: string;
  txid?: string;
}

const tokens = new Map<string, Token>();
const operations = new Map<string, Operation>();
let opCounter = 0;

const capabilities = {
  arbitraryDeploy: true,
  progressiveMint: true,
  customSupply: false,
  oracleAuthorization: true,
  canonicalBalanceQuery: true,
  transfer: true,
  marketplace: false,
  graduation: true,
  vault: false,
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    if (method === "GET" && path === "/capabilities") {
      return json(res, 200, capabilities);
    }

    if (method === "POST" && path === "/deploy/authorize") {
      const body = await readBody(req);
      const ticker = String(body.ticker ?? "").toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(ticker)) {
        return json(res, 400, { authorized: false, reason: "ticker must be 4 uppercase A-Z/0-9" });
      }
      if ([...tokens.values()].some((t) => t.ticker === ticker)) {
        return json(res, 409, { authorized: false, reason: "ticker taken" });
      }
      const deploymentId = `crc-${ticker.toLowerCase()}-${Date.now().toString(16)}`;
      tokens.set(deploymentId, {
        deploymentId,
        ticker,
        profile: "crc-launch-v1",
        confirmedMintedAtoms: 0n,
        status: "LIVE",
      });
      return json(res, 200, { authorized: true, deploymentId, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    }

    if (method === "POST" && path === "/mint/authorize") {
      const body = await readBody(req);
      const token = tokens.get(String(body.deploymentId ?? ""));
      if (!token) return json(res, 404, { authorized: false, reason: "deployment not found" });
      const requested = BigInt(String(body.requestedAmountAtoms ?? "0"));
      if (requested <= 0n) return json(res, 400, { authorized: false, reason: "amount must be positive" });
      const currentUnits = token.confirmedMintedAtoms / ONE;
      const requestedUnits = requested / ONE;
      let quote;
      try {
        quote = quoteExactTokens({ desiredTokens: requestedUnits, currentSupply: currentUnits });
      } catch (e) {
        return json(res, 400, { authorized: false, reason: e instanceof Error ? e.message : "invalid mint" });
      }
      token.confirmedMintedAtoms = quote.supplyAfter * ONE;
      if (token.confirmedMintedAtoms >= PUBLIC_SUPPLY_ATOMS * ONE) token.status = "SOLD_OUT";
      const opId = `op-${++opCounter}`;
      operations.set(opId, { id: opId, kind: "mint", status: "accepted" });
      return json(res, 200, {
        authorized: true,
        authorizationId: opId,
        requiredPaymentSats: quote.curveContributionSats,
        tokenAmountAtoms: requested,
        startingStage: quote.startingStage,
        endingStage: quote.endingStage,
        supplyBeforeAtoms: quote.supplyBefore * ONE,
        supplyAfterAtoms: quote.supplyAfter * ONE,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
    }

    if (method === "POST" && path === "/operation/submit") {
      const body = await readBody(req);
      const opId = String(body.authorizationId ?? `op-${++opCounter}`);
      const op: Operation = operations.get(opId) ?? { id: opId, kind: String(body.operation ?? "unknown"), status: "accepted" };
      op.status = "accepted";
      op.txid = String(body.txid ?? "");
      operations.set(opId, op);
      return json(res, 200, { operationId: opId, status: "accepted" });
    }

    if (method === "GET" && path.startsWith("/tokens/")) {
      const id = decodeURIComponent(path.slice("/tokens/".length));
      const token = tokens.get(id);
      if (!token) return json(res, 404, { error: "not found" });
      const units = token.confirmedMintedAtoms / ONE;
      return json(res, 200, {
        deploymentId: token.deploymentId,
        ticker: token.ticker,
        status: token.status,
        totalSupplyAtoms: MAX_ATOMS,
        confirmedMintedAtoms: token.confirmedMintedAtoms,
        remainingPublicSupplyAtoms: getRemainingPublicSupply(units) * ONE,
        currentStage: getStageForSupply(units),
        stageCount: STAGE_COUNT,
        priceTableSatsPerMillion: STAGE_PRICES_SATS_PER_MILLION,
      });
    }

    if (method === "GET" && path.startsWith("/operations/")) {
      const id = decodeURIComponent(path.slice("/operations/".length));
      const op = operations.get(id);
      if (!op) return json(res, 404, { error: "not found" });
      return json(res, 200, op);
    }

    if (method === "GET" && path === "/activity") {
      return json(res, 200, { items: [], nextCursor: null });
    }

    if (method === "GET" && path === "/") {
      return json(res, 200, { service: "mock-canonical-crc", note: "This is a mock. See docs/openapi/crc-canonical-api.yaml." });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: e instanceof Error ? e.message : "internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-crc-service] listening on http://localhost:${PORT}`);
});
