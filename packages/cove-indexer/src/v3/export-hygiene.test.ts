import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Export hygiene (§1): the production V3 entrypoint must NOT export deterministic
 * REGTEST private keys. Test key material lives only under src/v3/testing/.
 */
const here = dirname(fileURLToPath(import.meta.url));
const prodIndex = readFileSync(join(here, "index.ts"), "utf8");

describe("production V3 export hygiene", () => {
  it("does not export REGTEST_KEYS", () => {
    expect(prodIndex).not.toMatch(/REGTEST_KEYS/);
  });
  it("does not export *_PRIV", () => {
    expect(prodIndex).not.toMatch(/_PRIV\b/);
  });
  it("does not re-export the testing fixture", () => {
    expect(prodIndex).not.toMatch(/testing\/regtest-fixture/);
    expect(prodIndex).not.toMatch(/regtest-fixture/);
  });
});
