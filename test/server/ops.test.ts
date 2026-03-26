import { describe, it, expect, vi, afterEach } from 'vitest';
import { RingBuffer } from '../../src/server/ops.js';

describe('Ops idempotency cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('evicts entries older than 24h on periodic cleanup interval', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);
    vi.resetModules();
    const { OPS } = await import('../../src/server/ops.js');

    OPS.reset();
    OPS.setIdempotency('old-entry', {
      bodyHash: 'old',
      status: 200,
      payload: { ok: true },
      createdAt: now - 25 * 60 * 60 * 1000,
    });
    OPS.setIdempotency('fresh-entry', {
      bodyHash: 'fresh',
      status: 200,
      payload: { ok: true },
      createdAt: now - 60 * 1000,
    });

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(OPS.getIdempotency('old-entry')).toBeNull();
    expect(OPS.getIdempotency('fresh-entry')).not.toBeNull();
    const counters = OPS.snapshot();
    expect(counters['shipyard.idempotency.evicted']?.value).toBe(1);
  });
});

describe('RingBuffer guards', () => {
  it('throws when capacity <= 0', () => {
    expect(() => new RingBuffer(0)).toThrow('RingBuffer capacity must be > 0');
    expect(() => new RingBuffer(-1)).toThrow('RingBuffer capacity must be > 0');
  });
});
