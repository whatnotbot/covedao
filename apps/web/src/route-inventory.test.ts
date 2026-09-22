import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P0-50: route inventory test. Confirms every API route referenced by the
 * frontend/build flow actually exists — a missing/typo'd route fails CI.
 */
const REQUIRED_ROUTES = [
  "/api/launch/validate",
  "/api/launch/build",
  "/api/launch/broadcast",
  "/api/mint/quote",
  "/api/mint/build",
  "/api/mint/broadcast",
  "/api/market/listings",
  "/api/market/sell/build",
  "/api/market/buy/build",
  "/api/market/cancel/build",
  "/api/market/broadcast",
];

describe("route inventory", () => {
  for (const route of REQUIRED_ROUTES) {
    it(`${route} exists`, () => {
      const rel = route.startsWith("/") ? route.slice(1) : route;
      const file = fileURLToPath(new URL(`./app/${rel}/route.ts`, import.meta.url));
      expect(existsSync(file), `${file} should exist`).toBe(true);
    });
  }
});
