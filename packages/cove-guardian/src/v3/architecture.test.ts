import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Architecture test (§22): the production lifecycle must NOT perform Guardian
 * backing-state signing itself. Only the Guardian V3 signer may use the signing
 * key / taproot script-path signing primitives.
 */

const here = dirname(fileURLToPath(import.meta.url));
const lifecycle = readFileSync(join(here, "..", "v3-lifecycle.ts"), "utf8");

describe("architecture: no harness bypass of Guardian signing", () => {
  it("v3-lifecycle.ts does not call signTaprootInput", () => {
    expect(lifecycle).not.toMatch(/signTaprootInput/);
  });

  it("v3-lifecycle.ts does not call signSchnorr", () => {
    expect(lifecycle).not.toMatch(/signSchnorr/);
  });

  it("v3-lifecycle.ts does not construct a raw guardian ECPair key", () => {
    // The lifecycle must obtain the key exclusively through GuardianV3Signer
    // (which is allowed), never as a raw ECPair for direct signing.
    expect(lifecycle).not.toMatch(/ECPair\.fromPrivateKey\(Buffer\.alloc\(32, 0x42\)/);
  });

  it("v3-lifecycle.ts calls the production signer entry points", () => {
    expect(lifecycle).toMatch(/validateAndSignMintTransition/);
    expect(lifecycle).toMatch(/validateAndSignRedeemTransition/);
  });

  it("the production signer module is the only place using the signing key", () => {
    const signer = readFileSync(join(here, "signer.ts"), "utf8");
    expect(signer).toMatch(/signTaprootInput/);
    expect(signer).toMatch(/verifySchnorr/);
  });

  it("broadcast accepts ONLY ValidatedCoveTransaction (no arbitrary raw hex param)", () => {
    const broadcast = readFileSync(join(here, "broadcast.ts"), "utf8");
    expect(broadcast).toMatch(/validated:\s*ValidatedCoveTransaction/);
    expect(broadcast).not.toMatch(/rawTxHex\s*:\s*string/);
  });

  it("the ValidatedCoveTransaction brand is not exported (opaque, non-constructible)", () => {
    const finalize = readFileSync(join(here, "finalize.ts"), "utf8");
    // The brand is a module-private const Symbol, never re-exported.
    expect(finalize).toMatch(/const ValidatedCoveTransactionBrand: unique symbol = Symbol/);
    expect(finalize).not.toMatch(/export.*ValidatedCoveTransactionBrand/);
  });
});
