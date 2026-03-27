import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';
import { configureAuditLog, getAuditLog, resetAuditLog } from '../../src/server/audit-log.js';

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(new InstructionLoop());
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://localhost:${port}/api` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('Integration hardening', () => {
  it('POST /invoke round-trip stores event, retries, and writes audit log', async () => {
    const prevToken = process.env['SHIPYARD_INVOKE_TOKEN'];
    process.env['SHIPYARD_INVOKE_TOKEN'] = 'invoke-token-123';
    resetAuditLog();
    configureAuditLog({ filePath: join(mkdtempSync(join(tmpdir(), 'shipyard-audit-int-')), 'audit.jsonl') });
    const { server, baseUrl } = await startServer();
    try {
      const invokeRes = await fetch(`${baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': 'corr-int-1',
          'X-Request-Id': 'req-int-1',
          'X-Idempotency-Key': 'idem-int-1',
          'X-Shipyard-Invoke-Token': 'invoke-token-123',
        },
        body: JSON.stringify({ instruction: 'integration invoke' }),
      });
      expect(invokeRes.status).toBe(200);
      const invokeBody = await invokeRes.json() as { eventId: string; status: string };
      expect(invokeBody.status).toBe('accepted');

      const eventsRes = await fetch(`${baseUrl}/invoke/events?limit=500`);
      expect(eventsRes.status).toBe(200);
      const events = await eventsRes.json() as Array<{ id: string }>;
      expect(events.some((ev) => ev.id === invokeBody.eventId)).toBe(true);

      const retryRes = await fetch(`${baseUrl}/invoke/events/${invokeBody.eventId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shipyard-Invoke-Token': 'invoke-token-123',
        },
      });
      expect(retryRes.status).toBe(200);
      const retryBody = await retryRes.json() as { status: string };
      expect(retryBody.status).toBe('accepted');

      const auditEntries = getAuditLog();
      expect(auditEntries.length).toBeGreaterThan(0);
      expect(auditEntries.some((e) => e.action === 'invoke')).toBe(true);
      expect(auditEntries.some((e) => e.action === 'retry-single')).toBe(true);
    } finally {
      await stopServer(server);
      if (prevToken === undefined) delete process.env['SHIPYARD_INVOKE_TOKEN'];
      else process.env['SHIPYARD_INVOKE_TOKEN'] = prevToken;
    }
  });

  it('accepts valid webhook HMAC and dedupes replayed delivery IDs', async () => {
    const prevSecret = process.env['GITHUB_WEBHOOK_SECRET'];
    process.env['GITHUB_WEBHOOK_SECRET'] = 'webhook-secret-123';
    const { server, baseUrl } = await startServer();
    try {
      const deliveryId = `delivery-${Date.now()}`;
      const payload = {
        action: 'created',
        sender: { login: 'octocat', type: 'User' },
        comment: { body: '/shipyard run', author_association: 'OWNER' },
      };
      const raw = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', 'webhook-secret-123').update(raw).digest('hex')}`;

      const first = await fetch(`${baseUrl}/github/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-delivery': deliveryId,
          'x-github-event': 'issue_comment',
        },
        body: raw,
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { status: string };
      expect(firstBody.status).toBe('accepted');

      const second = await fetch(`${baseUrl}/github/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-delivery': deliveryId,
          'x-github-event': 'issue_comment',
        },
        body: raw,
      });
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { status: string };
      expect(secondBody.status).toBe('duplicate');
    } finally {
      await stopServer(server);
      if (prevSecret === undefined) delete process.env['GITHUB_WEBHOOK_SECRET'];
      else process.env['GITHUB_WEBHOOK_SECRET'] = prevSecret;
    }
  });

  it('handles 100 concurrent invoke requests without memory-guard false critical', { timeout: 15_000 }, async () => {
    const prevToken = process.env['SHIPYARD_INVOKE_TOKEN'];
    process.env['SHIPYARD_INVOKE_TOKEN'] = 'invoke-token-stress';
    const { server, baseUrl } = await startServer();
    try {
      const beforeRes = await fetch(`${baseUrl}/invoke/events?limit=500`);
      const beforeEvents = await beforeRes.json() as Array<{ id: string }>;
      const beforeCount = beforeEvents.length;

      const requests = Array.from({ length: 100 }, (_, i) =>
        fetch(`${baseUrl}/invoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shipyard-Invoke-Token': 'invoke-token-stress',
            'X-Correlation-Id': `stress-${i}`,
          },
          body: JSON.stringify({ instruction: `stress invoke ${i}` }),
        }),
      );
      const responses = await Promise.all(requests);
      for (const res of responses) expect(res.status).toBe(200);

      const afterRes = await fetch(`${baseUrl}/invoke/events?limit=500`);
      const afterEvents = await afterRes.json() as Array<{ id: string }>;
      expect(afterEvents.length - beforeCount).toBeGreaterThanOrEqual(100);

      const memRes = await fetch(`${baseUrl}/memory`);
      expect(memRes.status).toBe(200);
      const mem = await memRes.json() as { pressure: string };
      expect(mem.pressure).not.toBe('critical');
    } finally {
      await stopServer(server);
      if (prevToken === undefined) delete process.env['SHIPYARD_INVOKE_TOKEN'];
      else process.env['SHIPYARD_INVOKE_TOKEN'] = prevToken;
    }
  });
});
