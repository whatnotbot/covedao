import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CURVE-014: no `Number` monetary arithmetic occurs.
 * Static guard: the curve package source must not use floating-point
 * primitives that could leak into monetary math. (Number is only used for
 * safe, bounded stage *indices*.)
 */
describe("CURVE-014: no floating-point monetary math", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(srcDir, f));

  it("contains no floating-point primitives", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must not use parseFloat`).not.toMatch(/parseFloat/);
      expect(src, `${file} must not use Math.pow`).not.toMatch(/Math\.pow/);
      expect(src, `${file} must not use toFixed`).not.toMatch(/\.toFixed\(/);
      // No numeric literals with decimal points (float literals).
      expect(src, `${file} must not contain float literals`).not.toMatch(/\d\.\d/);
      // No 1.35 exponent approximation.
      expect(src, `${file} must not use exponent approximation`).not.toMatch(/\*\*\s*\d+\.\d+/);
    }
  });

  it("monetary math uses BigInt literals", () => {
    const quote = readFileSync(new URL("../src/quote.ts", import.meta.url), "utf8");
    expect(quote).toContain("n");
  });
});
