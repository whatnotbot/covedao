import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { Metrics } from "./metrics.js";

describe("rate limiter (§60)", () => {
  it("allows up to the limit then rejects within the window", () => {
    const rl = new FixedWindowRateLimiter();
    const cfg = { limit: 3, windowMs: 1000 };
    const key = { scope: "walletScript", subject: "00", operation: "mint" };
    expect(rl.check(key, cfg, 1000).allowed).toBe(true);
    expect(rl.check(key, cfg, 1001).allowed).toBe(true);
    expect(rl.check(key, cfg, 1002).allowed).toBe(true);
    const fourth = rl.check(key, cfg, 1003);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
    // new window resets
    expect(rl.check(key, cfg, 2000).allowed).toBe(true);
  });

  it("scopes independently by subject/operation", () => {
    const rl = new FixedWindowRateLimiter();
    const cfg = { limit: 1, windowMs: 1000 };
    expect(rl.check({ scope: "ip", subject: "a", operation: "mint" }, cfg, 0).allowed).toBe(true);
    expect(rl.check({ scope: "ip", subject: "a", operation: "redeem" }, cfg, 0).allowed).toBe(true);
    expect(rl.check({ scope: "ip", subject: "b", operation: "mint" }, cfg, 0).allowed).toBe(true);
  });
});

describe("metrics (§62)", () => {
  it("counts and gauges snapshot", () => {
    const m = new Metrics();
    m.inc("guardian.signatures");
    m.inc("guardian.signatures", 2);
    m.gauge("market.listings_active", 7n);
    const s = m.snapshot();
    expect(s.counters["guardian.signatures"]).toBe(3);
    expect(s.gauges["market.listings_active"]).toBe("7");
  });
});
