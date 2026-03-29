/**
 * Tests for Task #23: Trace correlation ID propagation.
 *
 * Verifies X-Correlation-Id header propagation from ingress through
 * to run lifecycle events across all invoke routes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

let server: Server;
let baseUrl: string;

const loop = new InstructionLoop();

beforeAll(async () => {
  const app = createApp(loop);
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

// Helper: create an invoke event with optional correlation header
async function invokeWith(
  instruction: string,
  correlationId?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (correlationId) headers['x-correlation-id'] = correlationId;
  const res = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instruction }),
  });
  return (await res.json()) as Record<string, unknown>;
}

// Helper: fetch events list
async function getEvents(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${baseUrl}/invoke/events?limit=500`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// POST /invoke with X-Correlation-Id header
// ---------------------------------------------------------------------------

describe('POST /invoke correlation ID propagation', () => {
  it('includes caller-supplied correlationId in response', async () => {
    const body = await invokeWith('test correlation header', 'my-trace-abc-123');
    expect(body['status']).toBe('accepted');
    expect(body['correlationId']).toBe('my-trace-abc-123');
  }, 15_000);

  it('stores correlationId on event ingress when header provided', async () => {
    const traceId = `trace-${Date.now()}`;
    const body = await invokeWith('test ingress storage', traceId);
    const eventId = body['eventId'] as string;

    const events = await getEvents();
    const event = events.find((e) => e['id'] === eventId);
    expect(event).toBeDefined();

    const ingress = event!['ingress'] as Record<string, unknown>;
    expect(ingress['correlationId']).toBe(traceId);
  });

  it('auto-generates correlationId from eventId when no header', async () => {
    const body = await invokeWith('test auto-gen correlation');
    const eventId = body['eventId'] as string;
    expect(body['correlationId']).toBe(eventId);
  });

  it('auto-generated correlationId matches ingress correlationId', async () => {
    const body = await invokeWith('test auto-gen ingress match');
    const eventId = body['eventId'] as string;

    const events = await getEvents();
    const event = events.find((e) => e['id'] === eventId);
    expect(event).toBeDefined();

    const ingress = event!['ingress'] as Record<string, unknown>;
    expect(ingress['correlationId']).toBe(eventId);
  });
});

// ---------------------------------------------------------------------------
// POST /invoke/batch
// ---------------------------------------------------------------------------

describe('POST /invoke/batch correlation ID propagation', () => {
  it('each batch item gets correlationId from shared header', async () => {
    const traceId = `batch-trace-${Date.now()}`;
    const res = await fetch(`${baseUrl}/invoke/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': traceId,
      },
      body: JSON.stringify({
        items: [
          { instruction: 'batch item 1' },
          { instruction: 'batch item 2' },
          { instruction: 'batch item 3' },
        ],
      }),
    });

    const body = (await res.json()) as {
      results: Array<{ eventId: string; correlationId?: string; status: string }>;
    };

    expect(body.results).toHaveLength(3);
    for (const result of body.results) {
      if (result.status === 'accepted') {
        expect(result.correlationId).toBe(traceId);
      }
    }
  });

  it('batch items get auto-generated correlationId per-item when no header', async () => {
    const res = await fetch(`${baseUrl}/invoke/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { instruction: 'auto batch 1' },
          { instruction: 'auto batch 2' },
        ],
      }),
    });

    const body = (await res.json()) as {
      results: Array<{ eventId: string; correlationId?: string; status: string }>;
    };

    expect(body.results).toHaveLength(2);
    for (const result of body.results) {
      if (result.status === 'accepted') {
        // correlationId should be the eventId itself when no header
        expect(result.correlationId).toBe(result.eventId);
      }
    }
  });

  it('batch ingress objects carry correlationId', async () => {
    const traceId = `batch-ingress-${Date.now()}`;
    const res = await fetch(`${baseUrl}/invoke/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': traceId,
      },
      body: JSON.stringify({
        items: [{ instruction: 'batch ingress check' }],
      }),
    });

    const body = (await res.json()) as {
      results: Array<{ eventId: string; status: string }>;
    };
    const eventId = body.results[0]!.eventId;

    const events = await getEvents();
    const event = events.find((e) => e['id'] === eventId);
    expect(event).toBeDefined();

    const ingress = event!['ingress'] as Record<string, unknown>;
    expect(ingress['correlationId']).toBe(traceId);
  });
});

// ---------------------------------------------------------------------------
// GET /invoke/events — verify ingress.correlationId is populated
// ---------------------------------------------------------------------------

describe('GET /invoke/events — correlationId populated', () => {
  it('event ingress.correlationId is populated for invoke events', async () => {
    const traceId = `events-check-${Date.now()}`;
    const body = await invokeWith('events check correlation', traceId);
    const eventId = body['eventId'] as string;

    const events = await getEvents();
    const event = events.find((e) => e['id'] === eventId);
    expect(event).toBeDefined();
    expect(event!['ingress']).toBeDefined();

    const ingress = event!['ingress'] as Record<string, unknown>;
    expect(ingress['correlationId']).toBe(traceId);
  });
});

// ---------------------------------------------------------------------------
// Retry events inherit new correlationId, not original
// ---------------------------------------------------------------------------

describe('Retry correlation ID inheritance', () => {
  it('retry event gets its own correlationId from header, not original', async () => {
    // Create original event with one correlationId
    const originalBody = await invokeWith('retry correlation original', 'original-trace');
    const originalEventId = originalBody['eventId'] as string;

    // Retry with a different correlationId
    const retryRes = await fetch(`${baseUrl}/invoke/events/${originalEventId}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': 'retry-trace-new',
      },
    });

    const retryBody = (await retryRes.json()) as { eventId: string };
    const retryEventId = retryBody.eventId;

    const events = await getEvents();
    const retryEvent = events.find((e) => e['id'] === retryEventId);
    expect(retryEvent).toBeDefined();

    const ingress = retryEvent!['ingress'] as Record<string, unknown>;
    expect(ingress['correlationId']).toBe('retry-trace-new');
    // Ensure it's NOT the original trace
    expect(ingress['correlationId']).not.toBe('original-trace');
  });

  it('retry event auto-generates correlationId when no header', async () => {
    const originalBody = await invokeWith('retry auto-gen original');
    const originalEventId = originalBody['eventId'] as string;

    const retryRes = await fetch(`${baseUrl}/invoke/events/${originalEventId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const retryBody = (await retryRes.json()) as { eventId: string };
    const retryEventId = retryBody.eventId;

    const events = await getEvents();
    const retryEvent = events.find((e) => e['id'] === retryEventId);
    expect(retryEvent).toBeDefined();

    const ingress = retryEvent!['ingress'] as Record<string, unknown>;
    // Should be the retry's own eventId, not the original
    expect(ingress['correlationId']).toBe(retryEventId);
    expect(ingress['correlationId']).not.toBe(originalEventId);
  });
});
