import { FixedWindowRateLimiter } from "@crclaunch/cove-app";
import { fail } from "./api";

/**
 * Per-IP fixed-window rate limiting for the web API (§M4). A production
 * deployment layers a shared store behind the same interface; the enforcement
 * point is identical.
 */

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function createRateLimiter(): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter();
}

const defaultLimiter = createRateLimiter();

/** Returns a 429 Response when the caller exceeded the window, else null. */
export function checkRateLimit(req: Request, operation: string, limiter: FixedWindowRateLimiter = defaultLimiter): Response | null {
  const r = limiter.check({ scope: "ip", subject: clientIp(req), operation }, { limit: 120, windowMs: 60_000 });
  if (!r.allowed) return fail("RATE_LIMITED", "Too many requests. Please wait and retry.", 429);
  return null;
}
