import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';
import { OPS } from '../../src/server/ops.js';
import { hmacAuth } from '../../src/server/hmac-auth.js';
import { sanitizeHeaders } from '../../src/server/dead-letter.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(new InstructionLoop());
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}/api`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Security hardening', () => {
  it('increments unprotected invoke counter when SHIPYARD_INVOKE_TOKEN is unset', async () => {
    OPS.reset();
    const prev = process.env['SHIPYARD_INVOKE_TOKEN'];
    delete process.env['SHIPYARD_INVOKE_TOKEN'];
    try {
      const res = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'counter check' }),
      });
      expect(res.status).toBe(200);
      expect(OPS.snapshot()['shipyard.security.unprotected_invoke']?.value).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_INVOKE_TOKEN'];
      else process.env['SHIPYARD_INVOKE_TOKEN'] = prev;
    }
  }, 15_000);

  it('returns 500 when HMAC auth is enabled but rawBody is missing', () => {
    const prev = process.env['SHIPYARD_HMAC_SECRET'];
    process.env['SHIPYARD_HMAC_SECRET'] = 'secret';
    try {
      const req = { headers: {}, body: { a: 1 } } as any;
      let statusCode = 0;
      let payload: any;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          payload = body;
          return this;
        },
      } as any;
      const next = () => undefined;
      hmacAuth()(req, res, next);
      expect(statusCode).toBe(500);
      expect(payload.error).toContain('HMAC auth requires express.json({ verify: saveRawBody }) middleware');
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_HMAC_SECRET'];
      else process.env['SHIPYARD_HMAC_SECRET'] = prev;
    }
  });

  it('sanitizes partially-matching sensitive headers', () => {
    const sanitized = sanitizeHeaders({
      'X-Custom-Authorization': 'secret',
      'X-Trace-Id': 'trace',
    });
    expect(sanitized['X-Custom-Authorization']).toBeUndefined();
    expect(sanitized['X-Trace-Id']).toBe('trace');
  });

  it('rejects ack template update without X-Requested-With header', async () => {
    const res = await fetch(`${baseUrl}/settings/ack-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects non-local admin route writes without admin auth', async () => {
    const res = await fetch(`${baseUrl}/settings/model-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-host': 'agent.example.com',
        'x-forwarded-for': '203.0.113.5',
      },
      body: JSON.stringify({ openaiApiKey: 'test-key' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Admin auth required');
  });

  it('accepts command prefix containing regex special characters', async () => {
    const prevPrefix = process.env['SHIPYARD_COMMAND_PREFIX'];
    process.env['SHIPYARD_COMMAND_PREFIX'] = '$hip.yard+';
    const deliveryId = `deliv-${Date.now()}`;
    try {
      const res = await fetch(`${baseUrl}/github/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-delivery': deliveryId,
          'x-github-event': 'issue_comment',
        },
        body: JSON.stringify({
          action: 'created',
          sender: { login: 'alice', type: 'User' },
          comment: { body: '$hip.yard+ run tests', author_association: 'OWNER' },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('accepted');
    } finally {
      if (prevPrefix === undefined) delete process.env['SHIPYARD_COMMAND_PREFIX'];
      else process.env['SHIPYARD_COMMAND_PREFIX'] = prevPrefix;
    }
  });
});
