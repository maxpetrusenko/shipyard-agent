/**
 * Token scope separation for Shipyard API authentication.
 *
 * Env vars:
 *   SHIPYARD_API_KEY       - full access (backward compat)
 *   SHIPYARD_INVOKE_TOKEN  - invoke scope only (backward compat)
 *   SHIPYARD_RETRY_TOKEN   - retry scope only
 *   SHIPYARD_ADMIN_TOKEN   - admin scope (cancel, delete, settings)
 *   SHIPYARD_READ_TOKEN    - read-only (runs list, events, metrics)
 */

import type { Request } from 'express';

function firstHeaderValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0]?.trim() ?? '';
  return raw?.trim() ?? '';
}

function normalizeHost(raw: string): string {
  const first = raw.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!first) return '';
  if (first.startsWith('[')) {
    const end = first.indexOf(']');
    return end > 0 ? first.slice(1, end) : first;
  }
  return first.split(':')[0] ?? first;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLoopbackAddress(addr: string): boolean {
  const normalized = addr.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

export function requestLooksLocal(
  req: Pick<Request, 'headers' | 'ip' | 'socket'>,
): boolean {
  const rawHosts = [
    firstHeaderValue(req.headers['x-forwarded-host']),
    firstHeaderValue(req.headers['host']),
  ].filter(Boolean);
  const hostsLookLocal = rawHosts.length === 0
    ? true
    : rawHosts.every((raw) => isLoopbackHost(normalizeHost(raw)));

  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'])
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const ipCandidates = [
    ...forwardedFor,
    req.ip ?? '',
    req.socket?.remoteAddress ?? '',
  ].filter(Boolean);
  const addrLooksLocal = ipCandidates.length === 0
    ? true
    : ipCandidates.every(isLoopbackAddress);

  return hostsLookLocal && addrLooksLocal;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenScope = 'invoke' | 'retry' | 'admin' | 'read' | 'full';

export interface ScopedToken {
  token: string;
  scopes: TokenScope[];
}

// ---------------------------------------------------------------------------
// Scope hierarchy: admin implies retry + read
// ---------------------------------------------------------------------------

const SCOPE_IMPLIES: Record<TokenScope, TokenScope[]> = {
  full: ['invoke', 'retry', 'admin', 'read'],
  admin: ['retry', 'read'],
  invoke: ['retry'],  // invoke token holders can also retry (backward compat)
  retry: [],
  read: [],
};

// ---------------------------------------------------------------------------
// Token env var mapping
// ---------------------------------------------------------------------------

interface TokenEntry {
  envKey: string;
  scopes: TokenScope[];
}

const TOKEN_ENTRIES: TokenEntry[] = [
  { envKey: 'SHIPYARD_API_KEY', scopes: ['full'] },
  { envKey: 'SHIPYARD_INVOKE_TOKEN', scopes: ['invoke'] },
  { envKey: 'SHIPYARD_RETRY_TOKEN', scopes: ['retry'] },
  { envKey: 'SHIPYARD_ADMIN_TOKEN', scopes: ['admin'] },
  { envKey: 'SHIPYARD_READ_TOKEN', scopes: ['read'] },
];

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Resolve which scopes a given token string grants.
 * Returns empty array for unknown/invalid tokens.
 */
export function resolveTokenScopes(token: string): TokenScope[] {
  if (!token) return [];
  const trimmed = token.trim();
  if (!trimmed) return [];

  for (const entry of TOKEN_ENTRIES) {
    const envVal = process.env[entry.envKey]?.trim();
    if (envVal && envVal === trimmed) {
      return entry.scopes;
    }
  }

  return [];
}

/**
 * Check if a token grants the required scope (directly or via hierarchy).
 */
export function hasScope(token: string, required: TokenScope): boolean {
  const scopes = resolveTokenScopes(token);
  if (scopes.length === 0) return false;

  for (const scope of scopes) {
    if (scope === required) return true;
    if (SCOPE_IMPLIES[scope]?.includes(required)) return true;
  }

  return false;
}

/**
 * Extract Bearer token from request (Authorization header).
 * Falls back to x-shipyard-invoke-token header for backward compat.
 */
export function extractToken(req: Request): string {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // Backward compat: x-shipyard-invoke-token header
  const invokeHeader = req.headers['x-shipyard-invoke-token'];
  if (typeof invokeHeader === 'string' && invokeHeader.trim()) {
    return invokeHeader.trim();
  }

  return '';
}

/**
 * Check if a request has the required scope. Throws-style: returns true if
 * authorized, false if not. Caller should send 403 on false.
 *
 * When no scoped tokens are configured at all (only SHIPYARD_API_KEY or
 * nothing), this preserves backward compat:
 *   - If SHIPYARD_API_KEY is set, the global middleware already validated it.
 *     Route-level scope checks pass through (the token was already accepted).
 *   - If no tokens are configured at all, everything is open (dev mode).
 */
export function requireScope(req: Request, scope: TokenScope): boolean {
  // If no scoped tokens are configured for this scope category, pass through
  // (backward compat: the global Bearer check in app.ts already handled auth)
  if (!anyScopedTokenConfigured(scope)) return true;

  const token = extractToken(req);
  if (!token) return false;

  return hasScope(token, scope);
}

/**
 * Check whether any scoped token env vars are configured for a given scope.
 * Used for backward compat: if nobody set SHIPYARD_RETRY_TOKEN, don't block
 * retry endpoints (global SHIPYARD_API_KEY auth is sufficient).
 */
function anyScopedTokenConfigured(scope: TokenScope): boolean {
  // If SHIPYARD_API_KEY is the only token and it has 'full' scope,
  // that's handled by the global middleware — not by route-level checks.
  // We only enforce route-level scope checks when a *specific* scoped token
  // is configured for the given scope category.

  switch (scope) {
    case 'invoke':
      return Boolean(process.env['SHIPYARD_INVOKE_TOKEN']?.trim());
    case 'retry':
      // invoke implies retry, so SHIPYARD_INVOKE_TOKEN also configures retry scope
      return Boolean(
        process.env['SHIPYARD_RETRY_TOKEN']?.trim() ||
        process.env['SHIPYARD_INVOKE_TOKEN']?.trim(),
      );
    case 'admin':
      return Boolean(process.env['SHIPYARD_ADMIN_TOKEN']?.trim());
    case 'read':
      return Boolean(process.env['SHIPYARD_READ_TOKEN']?.trim());
    case 'full':
      return Boolean(process.env['SHIPYARD_API_KEY']?.trim());
    default:
      return false;
  }
}

/**
 * Validate a token is recognized (has any scope at all).
 * Used by the global middleware in app.ts.
 */
export function isValidToken(token: string): boolean {
  return resolveTokenScopes(token).length > 0;
}
