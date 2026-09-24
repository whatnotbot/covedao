/**
 * Phase 8 structured observability (§62). Minimal in-memory counters/gauges
 * exposed as a snapshot for an operational dashboard/alerting layer. A
 * production deployment attaches a real metrics backend behind the same
 * interface; the measurement points are identical.
 */

export type MetricName =
  | "guardian.validations"
  | "guardian.rejections"
  | "guardian.signatures"
  | "guardian.audit_failures"
  | "guardian.journal_conflicts"
  | "market.listings_active"
  | "market.broadcasts"
  | "market.confirmations"
  | "app.build_failures"
  | "app.broadcast_failures";

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, bigint>();

  inc(name: MetricName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  gauge(name: MetricName, value: bigint): void {
    this.gauges.set(name, value);
  }
  snapshot(): { counters: Record<string, number>; gauges: Record<string, string> } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const gauges: Record<string, string> = {};
    for (const [k, v] of this.gauges) gauges[k] = v.toString();
    return { counters, gauges };
  }
}
