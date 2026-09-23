import type { Sats } from "@crclaunch/curve";

/**
 * Canonical protocol configuration. Economic/fee/destination constants live
 * here — the validator reads these; it never trusts values supplied by the
 * transaction payload or the frontend.
 */
export interface ProtocolConfig {
  profile: string;
  decimals: number;
  /** Canonical platform treasury (launch fee + primary mint platform fee). */
  treasuryAddress: string;
  /** Canonical graduation reserve destination (curve contributions). */
  reserveAddress: string;
  /** Canonical protocol treasury for marketplace fees. */
  protocolFeeAddress: string;
  launchFeeSats: Sats;
  /** Basis points (100 = 1%) charged on the curve contribution at primary mint. */
  primaryMintFeeBps: bigint;
  /** Basis points charged to the buyer on marketplace settlement (0 = none). */
  marketplaceFeeBps: bigint;
  finalityConfirmations: number;
}

export const CRC_LAUNCH_V1_PROFILE = "crc-launch-v1";

export const MOCK_TREASURY_ADDRESS = "bc1qm0cktreasury000000000000000000000000000000000000";
export const MOCK_RESERVE_ADDRESS = "bc1qm0ckreserve000000000000000000000000000000000000000";
export const MOCK_PROTOCOL_FEE_ADDRESS = "bc1qm0ckprotocol0000000000000000000000000000000000";

export const DEFAULT_MOCK_PROTOCOL_CONFIG: ProtocolConfig = Object.freeze({
  profile: CRC_LAUNCH_V1_PROFILE,
  decimals: 8,
  treasuryAddress: MOCK_TREASURY_ADDRESS,
  reserveAddress: MOCK_RESERVE_ADDRESS,
  protocolFeeAddress: MOCK_PROTOCOL_FEE_ADDRESS,
  launchFeeSats: 10_000n,
  primaryMintFeeBps: 100n,
  marketplaceFeeBps: 0n,
  finalityConfirmations: 6,
});
