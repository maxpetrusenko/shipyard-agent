/**
 * Tests for event persistence (file + Postgres dual-backend).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventPersistence } from '../../src/server/event-persistence.js';
import type { PersistedInvokeEvent } from '../../src/server/event-persistence.js';
import { OPS } from '../../src/server/ops.js';

function makeEvent(overrides?: Partial<PersistedInvokeEvent>): PersistedInvokeEvent {
  return {
    id: randomUUID(),
    source: 'api',
    eventType: 'invoke',
    status: 'accepted',
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// File persistence
// ---------------------------------------------------------------------------

describe('EventPersistence file backend', () => {
  let dir: string;
  let ep: EventPersistence;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipyard-events-'));
    ep = new EventPersistence(dir, { forceFileEnabled: true });
  });

  it('saves and loads a single event round-trip', () => {
    const event = makeEvent({ source: 'github_webhook', reason: 'test' });
    const path = ep.saveEventToFile(event, dir);
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);

    // Verify raw JSON
    const raw = JSON.parse(readFileSync(path!, 'utf-8'));
    expect(raw.id).toBe(event.id);
    expect(raw.source).toBe('github_webhook');
    expect(raw.reason).toBe('test');

    // Round-trip via loadEventsFromFiles
    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(event.id);
    expect(loaded[0]!.source).toBe('github_webhook');
    expect(loaded[0]!.status).toBe('accepted');
    expect(loaded[0]!.reason).toBe('test');
  });

  it('saves multiple events and loads all', () => {
    const e1 = makeEvent({ source: 'api' });
    const e2 = makeEvent({ source: 'slack' });
    const e3 = makeEvent({ source: 'github_webhook', status: 'rejected' });

    ep.saveEventToFile(e1, dir);
    ep.saveEventToFile(e2, dir);
    ep.saveEventToFile(e3, dir);

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(3);

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(3);
    const ids = loaded.map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
    expect(ids).toContain(e3.id);
  });

  it('upserts (overwrites) event with same id', () => {
    const event = makeEvent({ status: 'accepted' });
    ep.saveEventToFile(event, dir);

    // Update status
    const updated = { ...event, status: 'rejected' as const };
    ep.saveEventToFile(updated, dir);

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.status).toBe('rejected');
  });

  it('skips invalid JSON files gracefully', () => {
    const event = makeEvent();
    ep.saveEventToFile(event, dir);

    // Write a bogus file
    const bogusPath = join(dir, 'bogus.json');
    writeFileSync(bogusPath, '{ not valid json !!!');

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(event.id);
  });

  it('skips files missing required fields', () => {
    const event = makeEvent();
    ep.saveEventToFile(event, dir);

    // Write a JSON file without id/source
    writeFileSync(join(dir, 'no-id.json'), JSON.stringify({ eventType: 'test' }));

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
  });

  it('returns empty array for non-existent directory', () => {
    const loaded = ep.loadEventsFromFiles('/tmp/shipyard-nonexistent-dir-12345');
    expect(loaded).toEqual([]);
  });

  it('preserves metadata through round-trip', () => {
    const event = makeEvent({
      metadata: {
        delivery: 'abc-123',
        repo: 'owner/repo',
        nested: { deep: true },
      },
    });
    ep.saveEventToFile(event, dir);

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded[0]!.metadata).toEqual(event.metadata);
  });

  it('isHealthy returns false after 3 consecutive file write failures', () => {
    const broken = new EventPersistence('/dev/null/shipyard-events-broken', { forceFileEnabled: true });
    broken.persistEvent(makeEvent());
    broken.persistEvent(makeEvent());
    broken.persistEvent(makeEvent());

    expect(broken.isHealthy()).toBe(false);
    expect(broken.health().healthy).toBe(false);
    expect(broken.health().lastError).toBeTruthy();
    expect(broken.health().lastWriteAt).toBeNull();
  });

  it('uses function-check for retentionTimer.unref', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref: true } as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    const local = new EventPersistence(dir, { forceFileEnabled: true });
    expect(() => local.startRetentionTimer(1000)).not.toThrow();
    local.stopRetentionTimer();
    expect(clearIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Postgres persistence (mocked)
// ---------------------------------------------------------------------------

describe('EventPersistence Postgres backend', () => {
  let ep: EventPersistence;

  function makeMockPool(tableExists = true, rows: Record<string, unknown>[] = []) {
    return {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT 1 FROM shipyard_invoke_events LIMIT 0')) {
          if (!tableExists) throw new Error('relation does not exist');
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO shipyard_invoke_events')) {
          return { rowCount: 1 };
        }
        if (sql.includes('SELECT * FROM shipyard_invoke_events WHERE id')) {
          return { rows: rows.slice(0, 1) };
        }
        if (sql.includes('SELECT * FROM shipyard_invoke_events')) {
          return { rows };
        }
        return { rows: [] };
      }),
    } as unknown as import('pg').Pool;
  }

  beforeEach(() => {
    ep = new EventPersistence(mkdtempSync(join(tmpdir(), 'shipyard-events-pg-')), { forceFileEnabled: true });
  });

  it('upserts event to Postgres', async () => {
    const pool = makeMockPool();
    ep.setPool(pool);

    const event = makeEvent();
    await ep.upsertEventPg(event);

    expect(pool.query).toHaveBeenCalledTimes(2); // verify table + insert
    const insertCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO shipyard_invoke_events');
    expect(insertCall[1][0]).toBe(event.id);
  });

  it('logs warning and continues when table does not exist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = makeMockPool(false);
    ep.setPool(pool);

    const event = makeEvent();
    await ep.upsertEventPg(event);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('shipyard_invoke_events table not found'),
    );
    // Only 1 call (the table verification that failed)
    expect(pool.query).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('retries missing pg table verification every 60s up to 5 attempts', async () => {
    OPS.reset();
    const nowSpy = vi.spyOn(Date, 'now');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    nowSpy.mockImplementation(() => nowMs);

    const pool = makeMockPool(false);
    ep.setPool(pool);
    const event = makeEvent();

    for (let i = 0; i < 5; i++) {
      await ep.upsertEventPg(event);
      await ep.upsertEventPg(event); // immediate second call should be backoff-skipped
      nowMs += 60_000;
    }
    const callsAfterFive = (pool.query as ReturnType<typeof vi.fn>).mock.calls.length;
    await ep.upsertEventPg(event); // giveup, no further checks
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFive);

    const counters = OPS.snapshot();
    expect(counters['shipyard.persistence.pg_reconnect_attempts']?.value).toBe(5);
    expect(counters['shipyard.persistence.pg_reconnect_giveup']?.value).toBe(1);
    nowSpy.mockRestore();
  });

  it('gets event by id from Postgres', async () => {
    const event = makeEvent();
    const pgRow = {
      id: event.id,
      source: event.source,
      event_type: event.eventType,
      status: event.status,
      reason: null,
      run_id: null,
      metadata: null,
      received_at: event.receivedAt,
    };
    const pool = makeMockPool(true, [pgRow]);
    ep.setPool(pool);

    const result = await ep.getEventPg(event.id);
    expect(result).toBeTruthy();
    expect(result!.id).toBe(event.id);
    expect(result!.source).toBe(event.source);
  });

  it('returns null for non-existent event', async () => {
    const pool = makeMockPool(true, []);
    ep.setPool(pool);

    const result = await ep.getEventPg('non-existent');
    expect(result).toBeNull();
  });

  it('lists events with filters', async () => {
    const rows = [
      {
        id: 'e1',
        source: 'api',
        event_type: 'invoke',
        status: 'accepted',
        reason: null,
        run_id: 'r1',
        metadata: JSON.stringify({ key: 'val' }),
        received_at: new Date().toISOString(),
      },
    ];
    const pool = makeMockPool(true, rows);
    ep.setPool(pool);

    const events = await ep.listEventsPg({ source: 'api', limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('e1');
    expect(events[0]!.metadata).toEqual({ key: 'val' });
  });
});

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

describe('EventPersistence unified API', () => {
  let dir: string;
  let ep: EventPersistence;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipyard-events-unified-'));
    ep = new EventPersistence(dir, { forceFileEnabled: true });
  });

  it('persistEvent saves to file (no Postgres)', () => {
    const event = makeEvent();
    ep.persistEvent(event);

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(event.id);
  });

  it('loadEvents falls back to file when no Postgres', async () => {
    const e1 = makeEvent({ receivedAt: '2024-01-01T00:00:00.000Z' });
    const e2 = makeEvent({ receivedAt: '2024-06-01T00:00:00.000Z' });
    ep.saveEventToFile(e1, dir);
    ep.saveEventToFile(e2, dir);

    const events = await ep.loadEvents({ limit: 10 });
    expect(events).toHaveLength(2);
    // Newest first
    expect(events[0]!.receivedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('loadEvents applies source filter on file fallback', async () => {
    ep.saveEventToFile(makeEvent({ source: 'api' }), dir);
    ep.saveEventToFile(makeEvent({ source: 'slack' }), dir);

    const events = await ep.loadEvents({ source: 'api' });
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('api');
  });

  it('loadEvents applies status filter on file fallback', async () => {
    ep.saveEventToFile(makeEvent({ status: 'accepted' }), dir);
    ep.saveEventToFile(makeEvent({ status: 'rejected' }), dir);
    ep.saveEventToFile(makeEvent({ status: 'ignored' }), dir);

    const events = await ep.loadEvents({ status: 'rejected' });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('rejected');
  });

  it('loadEvents respects limit on file fallback', async () => {
    for (let i = 0; i < 10; i++) {
      ep.saveEventToFile(makeEvent(), dir);
    }

    const events = await ep.loadEvents({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('normalizes invalid status to ignored', () => {
    const event = makeEvent();
    // Write file with bogus status
    writeFileSync(
      join(dir, `${event.id}.json`),
      JSON.stringify({ ...event, status: 'BOGUS' }),
    );

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.status).toBe('ignored');
  });
});
