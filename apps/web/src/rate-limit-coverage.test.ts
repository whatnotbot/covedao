import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every /api/v3 route handler must enforce rate limiting (§M4). The limiter
 * existed but was wired to nothing, leaving all 31 routes unthrottled — an
 * unauthenticated caller could lock listings, spam quote/prepare endpoints, and
 * exhaust Core RPC. This guard fails the build the moment a new route ships
 * without `checkRateLimit`, so the coverage cannot silently regress.
 */

const API_ROOT = join(import.meta.dirname, "app", "api", "v3");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("rate-limit coverage (§M4)", () => {
  const files = routeFiles(API_ROOT);

  it("finds the v3 route surface", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every v3 route calls checkRateLimit", () => {
    const unprotected = files
      .filter((f) => !readFileSync(f, "utf8").includes("checkRateLimit"))
      .map((f) => f.slice(API_ROOT.length + 1));
    expect(unprotected).toEqual([]);
  });

  it("every exported handler is reached by the guard, not just imported", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      // one guard call per exported handler
      const guards = [...src.matchAll(/checkRateLimit\(/g)].length;
      if (handlers.length > guards) missing.push(`${f.slice(API_ROOT.length + 1)} (${handlers.length} handlers, ${guards} guards)`);
    }
    expect(missing).toEqual([]);
  });
});
