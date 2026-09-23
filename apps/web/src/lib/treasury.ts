export const MOCK_TREASURY_ADDRESS = "bc1qm0cktreasury000000000000000000000000000000000000";

export function treasuryAddress(config: { network: string; treasuryAddress: string | null }): string {
  if (config.treasuryAddress) return config.treasuryAddress;
  if (config.network === "mock") return MOCK_TREASURY_ADDRESS;
  throw new Error("PLATFORM_TREASURY_ADDRESS is required for non-mock networks.");
}
