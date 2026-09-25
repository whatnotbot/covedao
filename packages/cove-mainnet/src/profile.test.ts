import { describe, expect, it } from "vitest";
import { TOKEN_CARRIER_SATS, RESERVE_ANCHOR_SATS } from "@crclaunch/cove-covenant";
import { MINT_CMR, REDEEM_CMR } from "@crclaunch/cove-simplicity";
import { PUBLIC_SUPPLY_ATOMS, GRADUATION_RESERVE_ATOMS } from "@crclaunch/curve";
import {
  parseMainnetProfileJson,
  validateMainnetProfile,
  hashMainnetProfile,
  canonicalMainnetProfileBytes,
  isStandardMainnetScript,
  type MainnetProfile,
} from "./profile.js";

// Recovery/Guardian keys MUST be on the secp256k1 curve — an off-curve x-only
// key yields a tapleaf no signature can satisfy. ("11".repeat(32) is NOT on the
// curve and was silently accepted before the isXOnlyKey check.)
const K1 = "12".repeat(32);
const K2 = "22".repeat(32);
const K3 = "33".repeat(32);
const OFF_CURVE_KEY = "11".repeat(32);

function completeProfile(overrides: Partial<MainnetProfile> = {}): MainnetProfile {
  return {
    profileVersion: 1,
    chainIdentity: "bitcoin-mainnet",
    activationHeight: 900_000n,
    policyVersion: 3,
    vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
    guardianXOnly: "44".repeat(32),
    recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 2016 },
    feeScript: "0014" + "e".repeat(40),
    buyFeeBps: 100,
    redeemFeeBps: 100,
    p2pFeeBps: 100,
    carrierSats: TOKEN_CARRIER_SATS,
    anchorSats: RESERVE_ANCHOR_SATS,
    maxProtocolSupplyAtoms: PUBLIC_SUPPLY_ATOMS,
    reserveAllocationAtoms: GRADUATION_RESERVE_ATOMS,
    mintCmr: MINT_CMR,
    redeemCmr: REDEEM_CMR,
    canary: {
      allowedWalletScripts: ["0014" + "a".repeat(40)],
      allowedTokenIds: ["ab".repeat(32)],
      maxBackingSats: 1_000_000_000n,
      maxSingleBuySats: 50_000_000n,
      maxSingleRedeemPayoutSats: 50_000_000n,
      maxP2pSettlementSats: 10_000_000n,
      maxMintAtoms: 2_100_000n * 100_000_000n,
      minMintGrossSats: 5_000n,
    },
    ...overrides,
  };
}

describe("canonical mainnet profile", () => {
  it("validates a complete profile", () => {
    const r = validateMainnetProfile(completeProfile());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an incomplete (template) profile with OWNER_DECISION_REQUIRED", () => {
    const json = {
      profileVersion: 1,
      chainIdentity: "bitcoin-mainnet",
      activationHeight: null,
      policyVersion: 3,
      vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
      guardianXOnly: null,
      recovery: { threshold: 2, pubkeys: [], csvBlocks: null },
      feeScript: null,
      buyFeeBps: null,
      redeemFeeBps: null,
      p2pFeeBps: null,
      carrierSats: String(TOKEN_CARRIER_SATS),
      anchorSats: String(RESERVE_ANCHOR_SATS),
      maxProtocolSupplyAtoms: String(PUBLIC_SUPPLY_ATOMS),
      reserveAllocationAtoms: String(GRADUATION_RESERVE_ATOMS),
      mintCmr: MINT_CMR,
      redeemCmr: REDEEM_CMR,
      canary: { allowedWalletScripts: [], allowedTokenIds: [], maxBackingSats: null, maxSingleBuySats: null, maxSingleRedeemPayoutSats: null, maxP2pSettlementSats: null },
    };
    const p = parseMainnetProfileJson(JSON.stringify(json));
    const r = validateMainnetProfile(p);
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => e.startsWith("OWNER_DECISION_REQUIRED"))).toHaveLength(16);
  });

  it("rejects a protocol mismatch on frozen values (PROFILE_PROTOCOL_MISMATCH)", () => {
    const p = completeProfile({ carrierSats: 999n });
    const r = validateMainnetProfile(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("PROFILE_PROTOCOL_MISMATCH") && e.includes("carrierSats"))).toBe(true);
  });

  it("rejects a wrong CMR (PROFILE_PROTOCOL_MISMATCH)", () => {
    const p = completeProfile({ mintCmr: "00".repeat(32) });
    const r = validateMainnetProfile(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("mintCmr"))).toBe(true);
  });

  it("rejects a non-2-of-3 recovery threshold", () => {
    const p = completeProfile({ recovery: { threshold: 3, pubkeys: [K1, K2, K3], csvBlocks: 2016 } });
    const r = validateMainnetProfile(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("INVALID_RECOVERY_THRESHOLD"))).toBe(true);
  });

  it("rejects an out-of-range CSV delay", () => {
    expect(validateMainnetProfile(completeProfile({ recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 65_536 } })).ok).toBe(false);
    expect(validateMainnetProfile(completeProfile({ recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 0 } })).ok).toBe(false);
  });

  it("rejects a non-standard fee script", () => {
    expect(validateMainnetProfile(completeProfile({ feeScript: "6a" })).ok).toBe(false);
  });

  it("rejects a fee out of 0..10000 bps", () => {
    expect(validateMainnetProfile(completeProfile({ buyFeeBps: 10_001 })).ok).toBe(false);
    expect(validateMainnetProfile(completeProfile({ buyFeeBps: -1 })).ok).toBe(false);
  });

  it("canonicalizes pubkey order (sort) and produces a deterministic hash", () => {
    const sorted = completeProfile({ recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 2016 } });
    const unsorted = completeProfile({ recovery: { threshold: 2, pubkeys: [K3, K1, K2], csvBlocks: 2016 } });
    expect(hashMainnetProfile(sorted)).toBe(hashMainnetProfile(unsorted));
  });

  it("hash changes when any owner decision changes", () => {
    const a = completeProfile();
    const b = completeProfile({ activationHeight: 900_001n });
    expect(hashMainnetProfile(a)).not.toBe(hashMainnetProfile(b));
  });

  it("canonical bytes are endian-frozen and non-empty", () => {
    const bytes = canonicalMainnetProfileBytes(completeProfile());
    expect(bytes.length).toBeGreaterThan(0);
    // deterministic across calls
    expect(canonicalMainnetProfileBytes(completeProfile()).equals(bytes)).toBe(true);
  });

  it("detects standard vs non-standard scripts", () => {
    expect(isStandardMainnetScript("0014" + "a".repeat(40))).toBe(true); // P2WPKH
    expect(isStandardMainnetScript("5120" + "b".repeat(64))).toBe(true); // P2TR
    expect(isStandardMainnetScript("76a914" + "c".repeat(40) + "88ac")).toBe(true); // P2PKH
    expect(isStandardMainnetScript("6a")).toBe(false);
    expect(isStandardMainnetScript("")).toBe(false);
  });
});

function fullJson(): Record<string, unknown> {
  return {
    profileVersion: 1,
    chainIdentity: "bitcoin-mainnet",
    activationHeight: "900000",
    policyVersion: 3,
    vaultProfileVersion: "COVE_V3_VAULT_PROFILE_MAINNET1",
    guardianXOnly: "44".repeat(32),
    recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 2016 },
    feeScript: "0014" + "e".repeat(40),
    buyFeeBps: 100,
    redeemFeeBps: 100,
    p2pFeeBps: 100,
    carrierSats: String(TOKEN_CARRIER_SATS),
    anchorSats: String(RESERVE_ANCHOR_SATS),
    maxProtocolSupplyAtoms: String(PUBLIC_SUPPLY_ATOMS),
    reserveAllocationAtoms: String(GRADUATION_RESERVE_ATOMS),
    mintCmr: MINT_CMR,
    redeemCmr: REDEEM_CMR,
    canary: {
      allowedWalletScripts: ["0014" + "a".repeat(40)],
      allowedTokenIds: ["ab".repeat(32)],
      maxBackingSats: "1000000000",
      maxSingleBuySats: "50000000",
      maxSingleRedeemPayoutSats: "50000000",
      maxP2pSettlementSats: "10000000",
      maxMintAtoms: "210000000000000",
      minMintGrossSats: "5000",
    },
  };
}

describe("strict profile parser (§P1-3)", () => {
  it("parses a complete profile", () => {
    const p = parseMainnetProfileJson(JSON.stringify(fullJson()));
    expect(validateMainnetProfile(p).ok).toBe(true);
  });

  it("rejects a deleted frozen version/identity field (no hardcoded literal)", () => {
    for (const key of ["profileVersion", "chainIdentity", "policyVersion", "vaultProfileVersion"]) {
      const j = fullJson();
      delete j[key];
      expect(() => parseMainnetProfileJson(JSON.stringify(j))).toThrow();
    }
  });

  it("rejects a mismatched version/identity literal", () => {
    expect(() => parseMainnetProfileJson(JSON.stringify({ ...fullJson(), chainIdentity: "bitcoin-signet" }))).toThrow(/chainIdentity/);
    expect(() => parseMainnetProfileJson(JSON.stringify({ ...fullJson(), policyVersion: 4 }))).toThrow(/policyVersion/);
    expect(() => parseMainnetProfileJson(JSON.stringify({ ...fullJson(), vaultProfileVersion: "OTHER" }))).toThrow(/vaultProfileVersion/);
  });

  it("rejects a deleted frozen protocol field (no constant fallback)", () => {
    for (const key of ["carrierSats", "anchorSats", "maxProtocolSupplyAtoms", "reserveAllocationAtoms", "mintCmr", "redeemCmr"]) {
      const j = fullJson();
      delete j[key];
      expect(() => parseMainnetProfileJson(JSON.stringify(j))).toThrow(new RegExp(key));
    }
  });

  it("rejects an off-curve guardianXOnly (unspendable execution leaves)", () => {
    const r = validateMainnetProfile(completeProfile({ guardianXOnly: OFF_CURVE_KEY }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/INVALID_GUARDIAN_KEY/);
  });

  it("rejects an off-curve recovery pubkey (unspendable recovery leaf)", () => {
    const r = validateMainnetProfile(
      completeProfile({ recovery: { threshold: 2, pubkeys: [OFF_CURVE_KEY, K2, K3], csvBlocks: 2016 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/INVALID_RECOVERY_KEY/);
  });

  it("rejects the Guardian key appearing in the recovery set", () => {
    const r = validateMainnetProfile(
      completeProfile({ guardianXOnly: K2, recovery: { threshold: 2, pubkeys: [K1, K2, K3], csvBlocks: 2016 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/GUARDIAN_KEY_IN_RECOVERY_SET/);
  });

  it("accepts on-curve keys", () => {
    expect(validateMainnetProfile(completeProfile()).ok).toBe(true);
  });

  it("rejects unknown keys at every scope", () => {
    expect(() => parseMainnetProfileJson(JSON.stringify({ ...fullJson(), evil: 1 }))).toThrow(/unknown profile key/);
    const withRecoveryEvil = fullJson() as unknown as { recovery: Record<string, unknown> };
    withRecoveryEvil.recovery.evil = 1;
    expect(() => parseMainnetProfileJson(JSON.stringify(withRecoveryEvil))).toThrow(/unknown recovery key/);
    const withCanaryEvil = fullJson() as unknown as { canary: Record<string, unknown> };
    withCanaryEvil.canary.evil = 1;
    expect(() => parseMainnetProfileJson(JSON.stringify(withCanaryEvil))).toThrow(/unknown canary key/);
  });
});

describe("per-mint risk limits (§25/§26)", () => {
  it("requires the operator to choose both, rather than inheriting a default", () => {
    for (const key of ["maxMintAtoms", "minMintGrossSats"] as const) {
      const p = completeProfile();
      p.canary[key] = null;
      const v = validateMainnetProfile(p);
      expect(v.ok).toBe(false);
      expect(v.errors.join(" ")).toContain(`OWNER_DECISION_REQUIRED: canary.${key}`);
    }
  });

  it("rejects a per-mint cap larger than the whole protocol supply", () => {
    const p = completeProfile();
    p.canary.maxMintAtoms = p.maxProtocolSupplyAtoms + 1n;
    const v = validateMainnetProfile(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("exceeds the protocol supply");
  });

  it("makes the profile hash depend on them", () => {
    // These are the numbers that bound how much a compromised API could mint
    // in one transaction, so a profile that changes them must not verify
    // against the previously committed hash.
    const base = hashMainnetProfile(completeProfile());
    const raised = completeProfile();
    raised.canary.maxMintAtoms = 4_200_000n * 100_000_000n;
    expect(hashMainnetProfile(raised)).not.toBe(base);

    const floored = completeProfile();
    floored.canary.minMintGrossSats = 6_000n;
    expect(hashMainnetProfile(floored)).not.toBe(base);
  });
});
