import { describe, expect, it } from "vitest";
import { makeCoveMainnetConfig } from "./config.js";

describe("makeCoveMainnetConfig (no usable mainnet config without activation values)", () => {
  const scripts = {
    settlementScript: "0014" + "11".repeat(20),
    treasuryScript: "0014" + "22".repeat(20),
  };

  it("builds a valid mainnet config with a future activation height + scripts", () => {
    const cfg = makeCoveMainnetConfig({ genesisHeight: 850_000, ...scripts });
    expect(cfg.network).toBe("mainnet");
    expect(cfg.genesisHeight).toBe(850_000);
    expect(cfg.settlementScript).toBe(scripts.settlementScript);
    expect(cfg.treasuryScript).toBe(scripts.treasuryScript);
  });

  it("rejects a non-positive activation height (no -1 sentinel)", () => {
    expect(() => makeCoveMainnetConfig({ genesisHeight: -1, ...scripts })).toThrow(/>= 1/);
    expect(() => makeCoveMainnetConfig({ genesisHeight: 0, ...scripts })).toThrow(/>= 1/);
  });

  it("rejects a non-integer activation height", () => {
    expect(() => makeCoveMainnetConfig({ genesisHeight: 1.5, ...scripts })).toThrow(/>= 1/);
  });

  it("rejects empty scripts", () => {
    expect(() => makeCoveMainnetConfig({ genesisHeight: 850_000, settlementScript: "", treasuryScript: scripts.treasuryScript })).toThrow(/settlementScript/);
    expect(() => makeCoveMainnetConfig({ genesisHeight: 850_000, settlementScript: scripts.settlementScript, treasuryScript: "" })).toThrow(/treasuryScript/);
  });

  it("rejects non-hex scripts", () => {
    expect(() => makeCoveMainnetConfig({ genesisHeight: 850_000, settlementScript: "zz", treasuryScript: scripts.treasuryScript })).toThrow(/settlementScript/);
  });
});
