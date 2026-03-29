/**
 * Tests for token scope separation (src/server/auth-scopes.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveTokenScopes,
  hasScope,
  requireScope,
  extractToken,
  isValidToken,
  requestLooksLocal,
} from '../../src/server/auth-scopes.js';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveEnv(): Record<string, string | undefined> {
  return {
    SHIPYARD_API_KEY: process.env['SHIPYARD_API_KEY'],
    SHIPYARD_INVOKE_TOKEN: process.env['SHIPYARD_INVOKE_TOKEN'],
    SHIPYARD_RETRY_TOKEN: process.env['SHIPYARD_RETRY_TOKEN'],
    SHIPYARD_ADMIN_TOKEN: process.env['SHIPYARD_ADMIN_TOKEN'],
    SHIPYARD_READ_TOKEN: process.env['SHIPYARD_READ_TOKEN'],
  };
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, val] of Object.entries(saved)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function clearTokenEnv(): void {
  delete process.env['SHIPYARD_API_KEY'];
  delete process.env['SHIPYARD_INVOKE_TOKEN'];
  delete process.env['SHIPYARD_RETRY_TOKEN'];
  delete process.env['SHIPYARD_ADMIN_TOKEN'];
  delete process.env['SHIPYARD_READ_TOKEN'];
}

function fakeRequest(opts: {
  authorization?: string;
  invokeToken?: string;
  host?: string;
  forwardedHost?: string;
  forwardedFor?: string;
  ip?: string;
  remoteAddress?: string;
}): Request {
  const headers: Record<string, string | undefined> = {};
  if (opts.authorization) headers['authorization'] = opts.authorization;
  if (opts.invokeToken) headers['x-shipyard-invoke-token'] = opts.invokeToken;
  if (opts.host) headers['host'] = opts.host;
  if (opts.forwardedHost) headers['x-forwarded-host'] = opts.forwardedHost;
  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor;
  return {
    headers,
    ip: opts.ip,
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth-scopes', () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = saveEnv();
    clearTokenEnv();
  });

  afterEach(() => {
    restoreEnv(envBackup);
  });

  // -------------------------------------------------------------------------
  // resolveTokenScopes
  // -------------------------------------------------------------------------

  describe('resolveTokenScopes', () => {
    it('returns full for SHIPYARD_API_KEY match', () => {
      process.env['SHIPYARD_API_KEY'] = 'my-api-key';
      expect(resolveTokenScopes('my-api-key')).toEqual(['full']);
    });

    it('returns invoke for SHIPYARD_INVOKE_TOKEN match', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'inv-tok';
      expect(resolveTokenScopes('inv-tok')).toEqual(['invoke']);
    });

    it('returns retry for SHIPYARD_RETRY_TOKEN match', () => {
      process.env['SHIPYARD_RETRY_TOKEN'] = 'retry-tok';
      expect(resolveTokenScopes('retry-tok')).toEqual(['retry']);
    });

    it('returns admin for SHIPYARD_ADMIN_TOKEN match', () => {
      process.env['SHIPYARD_ADMIN_TOKEN'] = 'admin-tok';
      expect(resolveTokenScopes('admin-tok')).toEqual(['admin']);
    });

    it('returns read for SHIPYARD_READ_TOKEN match', () => {
      process.env['SHIPYARD_READ_TOKEN'] = 'read-tok';
      expect(resolveTokenScopes('read-tok')).toEqual(['read']);
    });

    it('returns empty for unknown token', () => {
      process.env['SHIPYARD_API_KEY'] = 'real-key';
      expect(resolveTokenScopes('wrong-key')).toEqual([]);
    });

    it('returns empty for empty string', () => {
      expect(resolveTokenScopes('')).toEqual([]);
    });

    it('returns empty for whitespace-only token', () => {
      process.env['SHIPYARD_API_KEY'] = 'key';
      expect(resolveTokenScopes('   ')).toEqual([]);
    });

    it('trims token before comparison', () => {
      process.env['SHIPYARD_API_KEY'] = 'my-key';
      expect(resolveTokenScopes('  my-key  ')).toEqual(['full']);
    });

    it('prioritizes SHIPYARD_API_KEY when same value used for multiple', () => {
      process.env['SHIPYARD_API_KEY'] = 'shared';
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'shared';
      // API_KEY is checked first
      expect(resolveTokenScopes('shared')).toEqual(['full']);
    });
  });

  // -------------------------------------------------------------------------
  // hasScope
  // -------------------------------------------------------------------------

  describe('hasScope', () => {
    it('full access grants all scopes', () => {
      process.env['SHIPYARD_API_KEY'] = 'full-key';
      expect(hasScope('full-key', 'invoke')).toBe(true);
      expect(hasScope('full-key', 'retry')).toBe(true);
      expect(hasScope('full-key', 'admin')).toBe(true);
      expect(hasScope('full-key', 'read')).toBe(true);
      expect(hasScope('full-key', 'full')).toBe(true);
    });

    it('invoke scope grants retry (hierarchy)', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'inv';
      expect(hasScope('inv', 'invoke')).toBe(true);
      expect(hasScope('inv', 'retry')).toBe(true);
      expect(hasScope('inv', 'admin')).toBe(false);
      expect(hasScope('inv', 'read')).toBe(false);
    });

    it('admin scope grants retry and read', () => {
      process.env['SHIPYARD_ADMIN_TOKEN'] = 'adm';
      expect(hasScope('adm', 'admin')).toBe(true);
      expect(hasScope('adm', 'retry')).toBe(true);
      expect(hasScope('adm', 'read')).toBe(true);
      expect(hasScope('adm', 'invoke')).toBe(false);
    });

    it('retry scope only grants retry', () => {
      process.env['SHIPYARD_RETRY_TOKEN'] = 'ret';
      expect(hasScope('ret', 'retry')).toBe(true);
      expect(hasScope('ret', 'invoke')).toBe(false);
      expect(hasScope('ret', 'admin')).toBe(false);
      expect(hasScope('ret', 'read')).toBe(false);
    });

    it('read scope only grants read', () => {
      process.env['SHIPYARD_READ_TOKEN'] = 'rd';
      expect(hasScope('rd', 'read')).toBe(true);
      expect(hasScope('rd', 'invoke')).toBe(false);
      expect(hasScope('rd', 'retry')).toBe(false);
      expect(hasScope('rd', 'admin')).toBe(false);
    });

    it('unknown token has no scopes', () => {
      process.env['SHIPYARD_API_KEY'] = 'key';
      expect(hasScope('wrong', 'full')).toBe(false);
      expect(hasScope('wrong', 'invoke')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // extractToken
  // -------------------------------------------------------------------------

  describe('extractToken', () => {
    it('extracts Bearer token from Authorization header', () => {
      const req = fakeRequest({ authorization: 'Bearer my-token' });
      expect(extractToken(req)).toBe('my-token');
    });

    it('extracts x-shipyard-invoke-token header', () => {
      const req = fakeRequest({ invokeToken: 'inv-tok' });
      expect(extractToken(req)).toBe('inv-tok');
    });

    it('prefers Authorization header over x-shipyard-invoke-token', () => {
      const req = fakeRequest({
        authorization: 'Bearer bearer-tok',
        invokeToken: 'invoke-tok',
      });
      expect(extractToken(req)).toBe('bearer-tok');
    });

    it('returns empty string when no auth present', () => {
      const req = fakeRequest({});
      expect(extractToken(req)).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // isValidToken
  // -------------------------------------------------------------------------

  describe('isValidToken', () => {
    it('returns true for recognized token', () => {
      process.env['SHIPYARD_API_KEY'] = 'valid';
      expect(isValidToken('valid')).toBe(true);
    });

    it('returns false for unknown token', () => {
      process.env['SHIPYARD_API_KEY'] = 'valid';
      expect(isValidToken('invalid')).toBe(false);
    });

    it('returns true for any scoped token', () => {
      process.env['SHIPYARD_READ_TOKEN'] = 'rd';
      expect(isValidToken('rd')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // requireScope
  // -------------------------------------------------------------------------

  describe('requireScope', () => {
    it('passes through when no scoped token configured (backward compat)', () => {
      // No SHIPYARD_INVOKE_TOKEN set => invoke scope check passes
      const req = fakeRequest({});
      expect(requireScope(req, 'invoke')).toBe(true);
    });

    it('passes through for admin when no SHIPYARD_ADMIN_TOKEN', () => {
      const req = fakeRequest({});
      expect(requireScope(req, 'admin')).toBe(true);
    });

    it('blocks when invoke token is configured but request has wrong token', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'correct';
      const req = fakeRequest({ authorization: 'Bearer wrong' });
      expect(requireScope(req, 'invoke')).toBe(false);
    });

    it('allows when invoke token matches', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'correct';
      const req = fakeRequest({ authorization: 'Bearer correct' });
      expect(requireScope(req, 'invoke')).toBe(true);
    });

    it('allows API key for any scope', () => {
      process.env['SHIPYARD_API_KEY'] = 'master';
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'inv';
      const req = fakeRequest({ authorization: 'Bearer master' });
      expect(requireScope(req, 'invoke')).toBe(true);
    });

    it('allows invoke token for retry scope (hierarchy)', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'inv';
      const req = fakeRequest({ authorization: 'Bearer inv' });
      expect(requireScope(req, 'retry')).toBe(true);
    });

    it('blocks retry-only token from invoke scope', () => {
      process.env['SHIPYARD_INVOKE_TOKEN'] = 'inv';
      process.env['SHIPYARD_RETRY_TOKEN'] = 'ret';
      const req = fakeRequest({ authorization: 'Bearer ret' });
      expect(requireScope(req, 'invoke')).toBe(false);
    });

    it('allows admin token for retry scope', () => {
      process.env['SHIPYARD_ADMIN_TOKEN'] = 'adm';
      const req = fakeRequest({ authorization: 'Bearer adm' });
      expect(requireScope(req, 'retry')).toBe(true);
    });

    it('blocks when no token sent but scope configured', () => {
      process.env['SHIPYARD_ADMIN_TOKEN'] = 'adm';
      const req = fakeRequest({});
      expect(requireScope(req, 'admin')).toBe(false);
    });

    it('enforces read scope when SHIPYARD_READ_TOKEN is configured', () => {
      process.env['SHIPYARD_READ_TOKEN'] = 'read-only';
      const wrong = fakeRequest({ authorization: 'Bearer wrong' });
      const right = fakeRequest({ authorization: 'Bearer read-only' });
      expect(requireScope(wrong, 'read')).toBe(false);
      expect(requireScope(right, 'read')).toBe(true);
    });

    it('backward compat: only API_KEY set, all scopes pass via global middleware', () => {
      // When only SHIPYARD_API_KEY is set and no scoped tokens are configured,
      // route-level scope checks pass through because the global middleware
      // already validated the API key.
      process.env['SHIPYARD_API_KEY'] = 'master';
      const req = fakeRequest({ authorization: 'Bearer master' });
      expect(requireScope(req, 'invoke')).toBe(true);
      expect(requireScope(req, 'retry')).toBe(true);
      expect(requireScope(req, 'admin')).toBe(true);
      expect(requireScope(req, 'read')).toBe(true);
    });
  });

  describe('requestLooksLocal', () => {
    it('returns true for loopback host and address', () => {
      const req = fakeRequest({ host: 'localhost:4200', remoteAddress: '127.0.0.1' });
      expect(requestLooksLocal(req)).toBe(true);
    });

    it('returns false for non-local forwarded host', () => {
      const req = fakeRequest({
        host: 'localhost:4200',
        forwardedHost: 'agent.example.com',
        remoteAddress: '127.0.0.1',
      });
      expect(requestLooksLocal(req)).toBe(false);
    });

    it('returns false for non-local forwarded client address', () => {
      const req = fakeRequest({
        host: 'localhost:4200',
        forwardedFor: '203.0.113.5',
        remoteAddress: '127.0.0.1',
      });
      expect(requestLooksLocal(req)).toBe(false);
    });
  });
});
