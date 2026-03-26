/**
 * Machine-readable error codes for invoke-routes.ts responses.
 *
 * Every error response includes: { error: string, code: ErrorCode, details?: object }
 */

// ---------------------------------------------------------------------------
// Error code constants
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FIELD: 'INVALID_FIELD',
  UNSUPPORTED_EVENT: 'UNSUPPORTED_EVENT',
  RATE_LIMITED: 'RATE_LIMITED',
  QUEUE_FULL: 'QUEUE_FULL',
  AUTH_FAILED: 'AUTH_FAILED',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  NOT_FOUND: 'NOT_FOUND',
  NOT_REPLAYABLE: 'NOT_REPLAYABLE',
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  WEBHOOK_SENDER_DENIED: 'WEBHOOK_SENDER_DENIED',
  BOT_SENDER_SKIPPED: 'BOT_SENDER_SKIPPED',
  COMMAND_PREFIX_MISSING: 'COMMAND_PREFIX_MISSING',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---------------------------------------------------------------------------
// Error response builder
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

/**
 * Build a structured error response payload.
 */
export function apiError(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
): ApiError {
  const err: ApiError = { error: message, code };
  if (details && Object.keys(details).length > 0) {
    err.details = details;
  }
  return err;
}
