import { describe, expect, it } from "vitest";
import { decodeCoveEnvelope, encodeCoveDeploy, encodeCoveMint, encodeCoveTransfer } from "./envelope.js";
import { decodeCoveEnvelopeReference } from "./reference-parser.js";

const atoms = (t: number): bigint => BigInt(t) * 100_000_000n;

const vectors: { name: string; data: Uint8Array }[] = [
  { name: "deploy", data: encodeCoveDeploy("FROG") },
  { name: "mint", data: encodeCoveMint("FROG", atoms(2_000_000), 0n) },
  { name: "transfer", data: encodeCoveTransfer("FROG", atoms(500_000)) },
  { name: "mint-large-u64", data: encodeCoveMint("ZZZZ", (1n << 63n) - 1n, 123n) },
  { name: "non-cove", data: new TextEncoder().encode('{"p":"cove"}') },
  { name: "wrong-version", data: (() => { const d = encodeCoveDeploy("FROG"); d[4] = 2; return d; })() },
  { name: "bad-length", data: new Uint8Array([...encodeCoveDeploy("FROG"), 0]) },
  { name: "bad-ticker", data: (() => { const d = encodeCoveDeploy("FROG"); d[6] = 0x61; return d; })() },
  { name: "unknown-opcode", data: (() => { const d = encodeCoveDeploy("FROG"); d[5] = 0x7f; return d; })() },
];

describe("reference parser agrees with production parser", () => {
  for (const v of vectors) {
    it(v.name, () => {
      const prod = decodeCoveEnvelope(v.data);
      const ref = decodeCoveEnvelopeReference(v.data);
      if (prod.ok) {
        expect(ref.ok).toBe(true);
        expect(ref.op).toBe(prod.envelope!.op);
        if (prod.envelope!.op === "deploy") {
          expect(ref.tick).toBe(prod.envelope!.tick);
        } else if (prod.envelope!.op === "mint") {
          expect(ref.tick).toBe(prod.envelope!.tick);
          expect(ref.amt).toBe(prod.envelope!.amt);
          expect(ref.s).toBe(prod.envelope!.s);
        } else {
          expect(ref.tick).toBe(prod.envelope!.tick);
          expect(ref.amt).toBe(prod.envelope!.amt);
        }
      } else {
        expect(ref.ok).toBe(false);
        expect(ref.reason).toBe(prod.reason);
      }
    });
  }
});
