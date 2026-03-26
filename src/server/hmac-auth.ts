/**
 * Optional HMAC-SHA256 request signing for /invoke and /retry-batch.
 *
 * Env:
 *   SHIPYARD_HMAC_SECRET — if set, HMAC verification is required on
 *   protected routes. If unset, HMAC middleware is a no-op.
 *
 * Expected headers:
 *   X-Shipyard-Timestamp  — unix seconds (string)
 *   X-Shipyard-Signature  — hex(HMAC-SHA256(secret, timestamp + body))
 *
 * Replay protection: rejects requests with timestamp >5 minutes old.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum clock skew allowed (seconds). */
const MAX_SKEW_SECONDS = 300; // 5 minutes

const HEADER_TIMESTAMP = 'x-shipyard-timestamp';
const HEADER_SIGNATURE = 'x-shipyard-signature';

// ---------------------------------------------------------------------------
// Core verification
// ---------------------------------------------------------------------------

export interface HmacResult {
  valid: boolean;
  error?: string;
  status?: number;
}

/**
 * Verify HMAC-SHA256 signature on an incoming request.
 *
 * Returns `{ valid: true }` when:
 *   - No SHIPYARD_HMAC_SECRET is configured (disabled = pass-through)
 *   - Signature and timestamp are present, fresh, and correct
 *
 * Returns `{ valid: false, error }` otherwise.
 */
export function verifyHmac(req: Request): HmacResult {
  const secret = process.env['SHIPYARD_HMAC_SECRET']?.trim();
  if (!secret) {
    // HMAC not configured — pass through
    return { valid: true };
  }

  const reqRawBody = (req as RawBodyRequest).rawBody;
  if (reqRawBody === undefined) {
    return {
      valid: false,
      status: 500,
      error: 'HMAC auth requires express.json({ verify: saveRawBody }) middleware',
    };
  }

  // --- Timestamp ---
  const tsHeader = req.headers[HEADER_TIMESTAMP];
  if (typeof tsHeader !== 'string' || !tsHeader.trim()) {
    return { valid: false, error: 'Missing X-Shipyard-Timestamp header' };
  }

  const timestamp = parseInt(tsHeader.trim(), 10);
  if (Number.isNaN(timestamp)) {
    return { valid: false, error: 'Invalid X-Shipyard-Timestamp (not a number)' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSec - timestamp);
  if (drift > MAX_SKEW_SECONDS) {
    return {
      valid: false,
      error: `Timestamp too old or too far in the future (drift=${drift}s, max=${MAX_SKEW_SECONDS}s)`,
    };
  }

  // --- Signature ---
  const sigHeader = req.headers[HEADER_SIGNATURE];
  if (typeof sigHeader !== 'string' || !sigHeader.trim()) {
    return { valid: false, error: 'Missing X-Shipyard-Signature header' };
  }

  const providedSig = sigHeader.trim();

  // Body: use raw body if available, otherwise JSON-stringify the parsed body.
  // Express typically stores the raw buffer when configured with `express.json({ verify })`.
  const rawBody: string =
    typeof reqRawBody === 'string'
      ? reqRawBody
      : typeof reqRawBody === 'object' && Buffer.isBuffer(reqRawBody)
        ? reqRawBody.toString('utf-8')
        : typeof req.body === 'string'
          ? req.body
          : req.body != null
            ? (JSON.stringify(req.body) ?? '')
            : '';

  const payload = `${timestamp}${rawBody}`;
  const expectedSig = createHmac('sha256', secret)
    .update(payload, 'utf-8')
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (!safeCompare(providedSig, expectedSig)) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that enforces HMAC-SHA256 verification when
 * SHIPYARD_HMAC_SECRET is set. Responds with 401 on failure.
 */
export function hmacAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = verifyHmac(req);
    if (!result.valid) {
      res.status(result.status ?? 401).json({ error: result.error });
      return;
    }
    next();
  };
}

export function saveRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Request with optional rawBody (set by body-parser verify callback). */
interface RawBodyRequest extends Request {
  rawBody?: string | Buffer;
}

/**
 * Constant-time string comparison. Pads to equal length before comparing
 * to avoid leaking length information.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  // timingSafeEqual requires equal-length buffers
  if (bufA.length !== bufB.length) {
    // Still do a comparison to avoid short-circuit timing leak
    const padded = Buffer.alloc(bufA.length);
    timingSafeEqual(bufA, padded);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
