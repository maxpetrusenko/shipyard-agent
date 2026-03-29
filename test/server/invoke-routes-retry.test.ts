/**
 * Tests for Tasks #13 (retry-strategy), #14 (retry cap/cooldown), #15 (retry-preview).
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

// Helper: create an invoke event and return its eventId
async function createEvent(instruction = 'test instruction'): Promise<string> {
  const res = await fetch(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
  const body = (await res.json()) as { eventId: string };
  return body.eventId;
}

// Helper: create an event with high retryAttempts by retrying it N times
async function createEventWithRetries(count: number): Promise<string> {
  const eventId = await createEvent(`retry-cap-test-${Date.now()}`);
  let currentId = eventId;
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${baseUrl}/invoke/events/${currentId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status !== 200) break;
    const body = (await res.json()) as { eventId: string };
    currentId = body.eventId;
  }
  return currentId;
}

// ---------------------------------------------------------------------------
// Task #13: POST /invoke/events/retry-strategy
// ---------------------------------------------------------------------------

describe('POST /invoke/events/retry-strategy', () => {
  it('rejects unsupported strategy', async () => {
    const res = await fetch(`${baseUrl}/invoke/events/retry-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'unknown_strategy' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_FIELD');
  });

  it('returns empty match set with dry-run by default', async () => {
    const res = await fetch(`${baseUrl}/invoke/events/retry-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'queue_full_recent' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: number;
      retried: unknown[];
      dryRun: boolean;
    };
    expect(body.dryRun).toBe(true);
    expect(body.retried).toEqual([]);
    expect(typeof body.matched).toBe('number');
  });

  it('accepts custom minutesBack param', async () => {
    const res = await fetch(`${baseUrl}/invoke/events/retry-strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'queue_full_recent', minutesBack: 60 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dryRun: boolean };
    expect(body.dryRun).toBe(true);
  });

  it('requires auth when SHIPYARD_INVOKE_TOKEN is set', async () => {
    const prev = process.env['SHIPYARD_INVOKE_TOKEN'];
    process.env['SHIPYARD_INVOKE_TOKEN'] = 'secret-token-123';
    try {
      const res = await fetch(`${baseUrl}/invoke/events/retry-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: 'queue_full_recent' }),
      });
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_INVOKE_TOKEN'];
      else process.env['SHIPYARD_INVOKE_TOKEN'] = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Task #14: Retry cap and cooldown
// ---------------------------------------------------------------------------

describe('retry cap and cooldown', () => {
  it('rejects single retry when retry cap exceeded', async () => {
    const prev = process.env['SHIPYARD_MAX_RETRIES'];
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_MAX_RETRIES'] = '2';
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '0';
    try {
      // Create event then retry it twice to reach cap
      const lastId = await createEventWithRetries(2);

      const res = await fetch(`${baseUrl}/invoke/events/${lastId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(429);
      const body = (await res.json()) as {
        error: string;
        code: string;
        details: { maxRetries: number; attempts: number };
      };
      expect(body.error).toBe('Retry cap exceeded');
      expect(body.code).toBe('RATE_LIMITED');
      expect(body.details.maxRetries).toBe(2);
      expect(body.details.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_MAX_RETRIES'];
      else process.env['SHIPYARD_MAX_RETRIES'] = prev;
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  }, 15_000);

  it('rejects single retry during cooldown window', async () => {
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '600000'; // 10 minutes
    try {
      const eventId = await createEvent('cooldown-test');
      // First retry should succeed
      const first = await fetch(`${baseUrl}/invoke/events/${eventId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(first.status).toBe(200);

      // Immediately retry the same original event — should be in cooldown
      const second = await fetch(`${baseUrl}/invoke/events/${eventId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(second.status).toBe(429);
      const body = (await second.json()) as {
        error: string;
        code: string;
        details: { cooldownMs: number; retryAfterMs: number };
      };
      expect(body.error).toBe('Retry cooldown active');
      expect(body.code).toBe('RATE_LIMITED');
      expect(body.details.cooldownMs).toBe(600000);
      expect(body.details.retryAfterMs).toBeGreaterThan(0);
    } finally {
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  });

  it('returns rate_limited status in batch retry when cap exceeded', async () => {
    const prev = process.env['SHIPYARD_MAX_RETRIES'];
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_MAX_RETRIES'] = '2';
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '0';
    try {
      const cappedId = await createEventWithRetries(2);
      const freshId = await createEvent('batch-cap-test');

      const res = await fetch(`${baseUrl}/invoke/events/retry-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventIds: [cappedId, freshId] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: Array<{ originalEventId: string; status: string; error?: string }>;
      };

      const cappedResult = body.results.find((r) => r.originalEventId === cappedId);
      expect(cappedResult?.status).toBe('rate_limited');
      expect(cappedResult?.error).toBe('Retry cap exceeded');

      const freshResult = body.results.find((r) => r.originalEventId === freshId);
      expect(freshResult?.status).toBe('accepted');
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_MAX_RETRIES'];
      else process.env['SHIPYARD_MAX_RETRIES'] = prev;
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  });

  it('allows retry after cooldown expires (low cooldown)', async () => {
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '1'; // 1ms cooldown
    try {
      const eventId = await createEvent('fast-cooldown-test');
      // First retry
      const first = await fetch(`${baseUrl}/invoke/events/${eventId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(first.status).toBe(200);

      // Wait for cooldown to expire
      await new Promise((r) => setTimeout(r, 10));

      // Second retry of original should succeed since cooldown expired
      const second = await fetch(`${baseUrl}/invoke/events/${eventId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(second.status).toBe(200);
    } finally {
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  });
});

// ---------------------------------------------------------------------------
// Task #15: GET /invoke/events/retry-preview
// ---------------------------------------------------------------------------

describe('GET /invoke/events/retry-preview', () => {
  it('returns 400 when no eventIds provided', async () => {
    const res = await fetch(`${baseUrl}/invoke/events/retry-preview`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('MISSING_FIELD');
  });

  it('returns wouldRetry:true for retryable events', async () => {
    const eventId = await createEvent('preview-retryable-test');
    const res = await fetch(`${baseUrl}/invoke/events/retry-preview?eventIds=${eventId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ id: string; wouldRetry: boolean; reason: string | null }>;
      retryable: number;
      blocked: number;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.wouldRetry).toBe(true);
    expect(body.events[0]!.reason).toBeNull();
    expect(body.retryable).toBe(1);
    expect(body.blocked).toBe(0);
  });

  it('returns wouldRetry:false for cap-exceeded events', async () => {
    const prev = process.env['SHIPYARD_MAX_RETRIES'];
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_MAX_RETRIES'] = '2';
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '0';
    try {
      const cappedId = await createEventWithRetries(2);
      const res = await fetch(`${baseUrl}/invoke/events/retry-preview?eventIds=${cappedId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        events: Array<{ id: string; wouldRetry: boolean; reason: string | null }>;
        retryable: number;
        blocked: number;
      };
      expect(body.events).toHaveLength(1);
      expect(body.events[0]!.wouldRetry).toBe(false);
      expect(body.events[0]!.reason).toBe('Retry cap exceeded');
      expect(body.blocked).toBe(1);
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_MAX_RETRIES'];
      else process.env['SHIPYARD_MAX_RETRIES'] = prev;
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  });

  it('returns mixed retryable/blocked for multiple events', async () => {
    const prev = process.env['SHIPYARD_MAX_RETRIES'];
    const prevCooldown = process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
    process.env['SHIPYARD_MAX_RETRIES'] = '2';
    process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = '0';
    try {
      const freshId = await createEvent('preview-mixed-fresh');
      const cappedId = await createEventWithRetries(2);

      const res = await fetch(
        `${baseUrl}/invoke/events/retry-preview?eventIds=${freshId},${cappedId}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        events: Array<{ id: string; wouldRetry: boolean; reason: string | null }>;
        retryable: number;
        blocked: number;
      };
      expect(body.events).toHaveLength(2);
      expect(body.retryable).toBe(1);
      expect(body.blocked).toBe(1);

      const fresh = body.events.find((e) => e.id === freshId);
      expect(fresh?.wouldRetry).toBe(true);

      const capped = body.events.find((e) => e.id === cappedId);
      expect(capped?.wouldRetry).toBe(false);
    } finally {
      if (prev === undefined) delete process.env['SHIPYARD_MAX_RETRIES'];
      else process.env['SHIPYARD_MAX_RETRIES'] = prev;
      if (prevCooldown === undefined) delete process.env['SHIPYARD_RETRY_COOLDOWN_MS'];
      else process.env['SHIPYARD_RETRY_COOLDOWN_MS'] = prevCooldown;
    }
  });

  it('handles non-existent event IDs gracefully', async () => {
    const res = await fetch(
      `${baseUrl}/invoke/events/retry-preview?eventIds=nonexistent-id-abc`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ id: string; wouldRetry: boolean; reason: string | null }>;
      retryable: number;
      blocked: number;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.wouldRetry).toBe(false);
    expect(body.events[0]!.reason).toBe('Event not found');
    expect(body.blocked).toBe(1);
  });

  it('does not execute any retries (read-only)', async () => {
    const eventId = await createEvent('preview-readonly-test');

    // Preview the event
    const previewRes = await fetch(
      `${baseUrl}/invoke/events/retry-preview?eventIds=${eventId}`,
    );
    expect(previewRes.status).toBe(200);

    // Check that the event still has 0 retry attempts
    const eventsRes = await fetch(`${baseUrl}/invoke/events?limit=500`);
    const events = (await eventsRes.json()) as Array<{
      id: string;
      retryAttempts: number;
      retryOfEventId?: string;
    }>;
    const original = events.find((e) => e.id === eventId);
    expect(original?.retryAttempts).toBe(0);
    // No retry child event should exist for this event
    const retryChild = events.find((e) => e.retryOfEventId === eventId);
    expect(retryChild).toBeUndefined();
  });
});
