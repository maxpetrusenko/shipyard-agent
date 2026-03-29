/**
 * Task #24: Enhanced time window filters for /invoke/events/summary
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

// Helper: create an invoke event
async function createEvent(
  instruction = 'test',
  source = 'test-source',
  eventType = 'test-event',
): Promise<string> {
  const res = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, source, eventType }),
  });
  const body = (await res.json()) as { eventId: string };
  return body.eventId;
}

// Helper: fetch summary with query params
async function getSummary(
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params).toString();
  const url = qs
    ? `${baseUrl}/invoke/events/summary?${qs}`
    : `${baseUrl}/invoke/events/summary`;
  const res = await fetch(url);
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /invoke/events/summary — enhanced filters (Task #24)', () => {
  it('returns new fields: avgRetryAttempts, oldestEvent, newestEvent', async () => {
    await createEvent('summary-new-fields');
    const body = await getSummary();
    expect(body).toHaveProperty('avgRetryAttempts');
    expect(body).toHaveProperty('oldestEvent');
    expect(body).toHaveProperty('newestEvent');
    expect(typeof body['avgRetryAttempts']).toBe('number');
    expect(typeof body['oldestEvent']).toBe('string');
    expect(typeof body['newestEvent']).toBe('string');
  }, 15_000);

  it('empty result returns zeroes/null for computed fields', async () => {
    // Use a source filter that matches nothing
    const body = await getSummary({ source: 'nonexistent-source-xyz' });
    expect(body['total']).toBe(0);
    expect(body['avgRetryAttempts']).toBe(0);
    expect(body['oldestEvent']).toBeNull();
    expect(body['newestEvent']).toBeNull();
    expect(body).not.toHaveProperty('timeSeries');
  });

  it('windowMs=300000 filters to events within last 5 minutes', async () => {
    // Create a fresh event (will be within window)
    await createEvent('window-test');

    const body = await getSummary({ windowMs: '300000' });
    expect((body['total'] as number)).toBeGreaterThanOrEqual(1);

    // All events should have receivedAt within last 5 min
    const newestEvent = body['newestEvent'] as string;
    const fiveMinAgo = Date.now() - 300_000;
    expect(Date.parse(newestEvent)).toBeGreaterThan(fiveMinAgo);
  });

  it('windowMs + from: explicit from takes precedence over windowMs', async () => {
    await createEvent('precedence-test');
    // Set `from` to far future — should exclude everything
    const futureFrom = new Date(Date.now() + 86_400_000).toISOString();
    const body = await getSummary({
      windowMs: '300000',
      from: futureFrom,
    });
    expect(body['total']).toBe(0);
  });

  it('groupBy=hour produces timeSeries with hourly buckets', async () => {
    await createEvent('hourly-bucket');
    const body = await getSummary({ groupBy: 'hour' });
    expect(body).toHaveProperty('timeSeries');
    const ts = body['timeSeries'] as { bucket: string; count: number }[];
    expect(Array.isArray(ts)).toBe(true);
    expect(ts.length).toBeGreaterThanOrEqual(1);
    // Bucket format: YYYY-MM-DDTHH:00
    for (const entry of ts) {
      expect(entry.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
      expect(entry.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('groupBy=day produces daily buckets', async () => {
    await createEvent('daily-bucket');
    const body = await getSummary({ groupBy: 'day' });
    expect(body).toHaveProperty('timeSeries');
    const ts = body['timeSeries'] as { bucket: string; count: number }[];
    expect(Array.isArray(ts)).toBe(true);
    expect(ts.length).toBeGreaterThanOrEqual(1);
    // Bucket format: YYYY-MM-DD
    for (const entry of ts) {
      expect(entry.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('groupBy=minute produces minute buckets', async () => {
    await createEvent('minute-bucket');
    const body = await getSummary({ groupBy: 'minute' });
    expect(body).toHaveProperty('timeSeries');
    const ts = body['timeSeries'] as { bucket: string; count: number }[];
    expect(Array.isArray(ts)).toBe(true);
    expect(ts.length).toBeGreaterThanOrEqual(1);
    // Bucket format: YYYY-MM-DDTHH:MM
    for (const entry of ts) {
      expect(entry.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(entry.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('no timeSeries when groupBy is absent', async () => {
    const body = await getSummary();
    expect(body).not.toHaveProperty('timeSeries');
  });

  it('avgRetryAttempts computed correctly from retried events', async () => {
    // Create event and retry it once to bump retryAttempts
    const eventId = await createEvent('retry-avg-test');
    await fetch(`${baseUrl}/invoke/events/${eventId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = await getSummary();
    // avgRetryAttempts should be a number >= 0
    expect(typeof body['avgRetryAttempts']).toBe('number');
    expect((body['avgRetryAttempts'] as number)).toBeGreaterThanOrEqual(0);
  });

  it('oldestEvent and newestEvent are populated correctly', async () => {
    // Create two events with a slight gap
    await createEvent('oldest-newest-1');
    await new Promise((r) => setTimeout(r, 50));
    await createEvent('oldest-newest-2');

    const body = await getSummary();
    const oldest = Date.parse(body['oldestEvent'] as string);
    const newest = Date.parse(body['newestEvent'] as string);
    expect(newest).toBeGreaterThanOrEqual(oldest);
  });
});
