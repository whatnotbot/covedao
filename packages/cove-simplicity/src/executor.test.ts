import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MINT_CMR,
  MINT_CMR_V1,
  executeMintV3,
  isSimplicityAvailable,
  type MintWitness,
} from "./simplicity.js";

const VALID: MintWitness = {
  amount: 420_000n,
  prevSupply: 0n,
  nextSupply: 420_000n,
  prevReserve: 0n,
  nextReserve: 21_000n,
  contribution: 21_000n,
};

function fakeBinary(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cove-sim-exec-"));
  const p = join(dir, "cove-simplicity");
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("Simplicity strict executor (fail-closed failure injection)", () => {
  it("A. missing binary → SIMPLICITY_BINARY_MISSING, no PASS", async () => {
    const r = await executeMintV3(VALID, { binaryPath: null });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_BINARY_MISSING");
  });

  it("B. malformed JSON → SIMPLICITY_MALFORMED_RESULT, no PASS", async () => {
    const r = await executeMintV3(VALID, { binaryPath: fakeBinary(`echo 'this is not json'`) });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_MALFORMED_RESULT");
  });

  it("B2. JSON missing result field → SIMPLICITY_MALFORMED_RESULT", async () => {
    const r = await executeMintV3(VALID, { binaryPath: fakeBinary(`echo '{"cmr":"${MINT_CMR}"}'`) });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_MALFORMED_RESULT");
  });

  it("C. mutated CMR → CMR_MISMATCH, no PASS", async () => {
    const wrong = "00".repeat(32);
    const r = await executeMintV3(VALID, {
      binaryPath: fakeBinary(`echo '{"cmr":"${wrong}","result":"PASS"}'`),
    });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("CMR_MISMATCH");
    expect(r.actualCmr).toBe(wrong);
  });

  it("G. old V1 CMR substituted → CMR_MISMATCH, no PASS", async () => {
    const r = await executeMintV3(VALID, {
      binaryPath: fakeBinary(`echo '{"cmr":"${MINT_CMR_V1}","result":"PASS"}'`),
    });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("CMR_MISMATCH");
  });

  it("D. Bit Machine FAIL → SIMPLICITY_REJECTED, no PASS", async () => {
    const r = await executeMintV3(VALID, {
      binaryPath: fakeBinary(`echo '{"cmr":"${MINT_CMR}","result":"FAIL"}'`),
    });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_REJECTED");
    expect(r.actualCmr).toBe(MINT_CMR);
  });

  it("E. timeout → SIMPLICITY_TIMEOUT, no PASS", async () => {
    const r = await executeMintV3(VALID, {
      binaryPath: fakeBinary(`sleep 2`),
      timeoutMs: 100,
    });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_TIMEOUT");
  });

  it("F. nonzero process exit → SIMPLICITY_EXECUTION_ERROR, no PASS", async () => {
    const r = await executeMintV3(VALID, { binaryPath: fakeBinary(`exit 3`) });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_EXECUTION_ERROR");
  });

  it("nonexistent binary path → SIMPLICITY_EXECUTION_ERROR", async () => {
    const r = await executeMintV3(VALID, { binaryPath: "/nonexistent/cove-simplicity" });
    expect(r.result).toBe("FAIL");
    expect(r.failure).toBe("SIMPLICITY_EXECUTION_ERROR");
  });
});

describe("Simplicity strict executor (real binary, happy path)", () => {
  it.skipIf(!isSimplicityAvailable())("valid witness PASSes with exact frozen CMR", async () => {
    const r = await executeMintV3(VALID);
    expect(r.policy).toBe("MINT");
    expect(r.expectedCmr).toBe(MINT_CMR);
    expect(r.actualCmr).toBe(MINT_CMR);
    expect(r.result).toBe("PASS");
    expect(r.failure).toBeNull();
  });
});
