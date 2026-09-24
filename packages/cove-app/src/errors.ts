/** Stable V3 application error codes (§71). */
export type AppErrorCode =
  | "WALLET_REQUIRED"
  | "WALLET_UNSUPPORTED"
  | "WRONG_NETWORK"
  | "CORE_UNAVAILABLE"
  | "INDEXER_UNHEALTHY"
  | "INDEXER_REBUILDING"
  | "INDEXER_DIVERGED"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_AMOUNT_INVALID"
  | "TICKER_INVALID"
  | "METADATA_INVALID"
  | "FUNDING_INPUT_SPENT"
  | "FUNDING_INPUT_INVALID"
  | "INSUFFICIENT_BTC"
  | "QUOTE_STALE"
  | "STATE_CHANGED"
  | "ECONOMIC_DUST"
  | "PROTOCOL_FEE_DUST"
  | "PSBT_MUTATED"
  | "WALLET_SIGNATURE_REJECTED"
  | "WALLET_SIGNATURE_INVALID"
  | "MEMPOOL_REJECTED"
  | "BROADCAST_FAILED"
  | "GUARDIAN_UNAVAILABLE"
  | "GUARDIAN_REJECTED"
  | "IDEMPOTENCY_CONFLICT"
  | "SESSION_NOT_FOUND"
  | "SESSION_STATE_INVALID"
  | "APP_DISABLED"
  | "MAINNET_DISABLED"
  | "LISTING_NOT_FOUND"
  | "RESERVATION_EXPIRED";

export class AppError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "AppError";
    this.code = code;
  }
}
