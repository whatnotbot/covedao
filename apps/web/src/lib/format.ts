/** Client-safe formatting helpers (no server-only deps). All inputs are strings/bigints. */

const ATOMS_PER_TOKEN = 100_000_000n;

/** Convert a display-token decimal string to an atom-string (no floats). */
export function displayTokensToAtoms(input: string): string {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("invalid token amount");
  const parts = s.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] ?? "").padEnd(8, "0").slice(0, 8) || "0";
  return (BigInt(whole) * 100_000_000n + BigInt(frac)).toString();
}

export function fmtInt(v: string | bigint | number): string {
  const n = typeof v === "string" ? BigInt(v) : BigInt(v);
  return n.toLocaleString("en-US");
}

export function fmtSats(v: string | bigint | number): string {
  return `${fmtInt(v)} sats`;
}

export function fmtBtc(sats: string | bigint | number): string {
  const s = BigInt(sats);
  const sign = s < 0n ? "-" : "";
  const abs = s < 0n ? -s : s;
  const whole = abs / 100_000_000n;
  const frac = abs % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${fracStr ? "." + fracStr : ""} BTC`;
}

/**
 * Abbreviate an ATOM amount as whole display tokens.
 *
 * The input is atoms (1 token = 1e8 atoms), so it must be scaled down before
 * the magnitude buckets are applied — otherwise the public cap of 840,000,000
 * tokens (8.4e16 atoms) renders as "84000000B" instead of "840M". One decimal
 * is kept, via integer arithmetic only: no floats touch a token amount.
 */
export function fmtTokens(atoms: string | bigint): string {
  const tokens = BigInt(atoms) / ATOMS_PER_TOKEN;
  // ×10 throughout preserves exactly one decimal place without floating point.
  if (tokens >= 1_000_000_000n) return `${trim((tokens * 10n) / 1_000_000_000n)}B`;
  if (tokens >= 1_000_000n) return `${trim((tokens * 10n) / 1_000_000n)}M`;
  if (tokens >= 1_000n) return `${trim((tokens * 10n) / 1_000n)}K`;
  return tokens.toString();
}

export function fmtPricePerMillion(sats: string | bigint | number): string {
  return `${fmtInt(sats)} sats / 1M`;
}

function trim(n: bigint): string {
  // n is already ×10 to preserve one decimal (e.g. 5292 => 529.2).
  const whole = n / 10n;
  const dec = n % 10n;
  return dec === 0n ? whole.toString() : `${whole}.${dec}`;
}

export function fmtProgressBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}
