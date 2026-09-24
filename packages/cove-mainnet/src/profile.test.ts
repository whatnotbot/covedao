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

const K1 = "11".repeat(32);
const K2 = "22".repeat(32);
const K3 = "33".repeat(32);

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
    expect(r.errors.filter((e) => e.startsWith("OWNER_DECISION_REQUIRED"))).toHaveLength(14);
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
