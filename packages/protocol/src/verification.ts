import type { OperationStatus, VerificationStatus } from "./types.js";

export const VERIFIED: OperationStatus = "VERIFIED";
export const UNVERIFIED: OperationStatus = "UNVERIFIED";

/**
 * PRECOP/CRC mainnet operations are UNVERIFIED until independently confirmed
 * from public protocol code and observable transactions (see
 * docs/PROTOCOL_VERIFICATION.md). No mainnet adapter may return a transaction
 * for an operation whose status is UNVERIFIED.
 */
export const PRECOP_MAINNET_VERIFICATION: VerificationStatus = Object.freeze({
  deploy: "UNVERIFIED",
  mint: "UNVERIFIED",
  transfer: "UNVERIFIED",
  dexAsk: "UNVERIFIED",
  dexBid: "UNVERIFIED",
  cancel: "UNVERIFIED",
  graduation: "UNVERIFIED",
});

/** Mock/test adapters model their own simulated protocol, so all ops are "verified". */
export const MOCK_VERIFICATION: VerificationStatus = Object.freeze({
  deploy: "VERIFIED",
  mint: "VERIFIED",
  transfer: "VERIFIED",
  dexAsk: "VERIFIED",
  dexBid: "VERIFIED",
  cancel: "VERIFIED",
  graduation: "VERIFIED",
});

export function opStatusFor(
  status: VerificationStatus,
  op: keyof VerificationStatus,
): OperationStatus {
  return status[op];
}
