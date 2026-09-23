import { describe, expect, it } from "vitest";
import { dustThreshold, isP2TR, isP2WPKH, isWitnessProgram } from "./dust.js";

const P2WPKH = Buffer.from("0014" + "ab".repeat(20), "hex");
const P2TR = Buffer.from("5120" + "cd".repeat(32), "hex");
const P2PKH = Buffer.from("76a914" + "11".repeat(20) + "88ac", "hex");

describe("dustThreshold (Bitcoin Core GetDustThreshold)", () => {
  it("P2WPKH dust = 294 sats", () => {
    expect(dustThreshold(P2WPKH)).toBe(294n);
  });

  it("P2TR dust = 330 sats", () => {
    expect(dustThreshold(P2TR)).toBe(330n);
  });

  it("P2PKH dust = 546 sats", () => {
    expect(dustThreshold(P2PKH)).toBe(546n);
  });

  it("OP_RETURN is unspendable → 0 dust; empty script is spendable (471)", () => {
    expect(dustThreshold(Buffer.from("6a0b636f696e62696e2e6f7267", "hex"))).toBe(0n);
    expect(dustThreshold(Buffer.alloc(0))).toBe(471n); // Core: anyone-can-spend
  });

  it("classifies witness programs", () => {
    expect(isP2WPKH(P2WPKH)).toBe(true);
    expect(isP2TR(P2TR)).toBe(true);
    expect(isWitnessProgram(P2WPKH)).toBe(true);
    expect(isWitnessProgram(P2TR)).toBe(true);
    expect(isWitnessProgram(P2PKH)).toBe(false);
  });

  it("accepts witness versions 2-16 and P2WSH (Core-compatible)", () => {
    const p2wsh = Buffer.from("0020" + "cd".repeat(32), "hex");
    const v2 = Buffer.from("5220" + "cd".repeat(32), "hex");
    const v16 = Buffer.from("6020" + "cd".repeat(32), "hex");
    expect(dustThreshold(p2wsh)).toBe(330n);
    expect(dustThreshold(v2)).toBe(330n);
    expect(dustThreshold(v16)).toBe(330n);
  });

  it("truncates (Core GetFee) at a non-default rate", () => {
    const rate = 3001n;
    // nSize for P2WPKH = 98 → 98*3001/1000 = 294.098 → truncates to 294.
    expect(dustThreshold(P2WPKH, rate)).toBe((98n * rate) / 1000n);
  });
});
