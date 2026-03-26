import { describe, it, expect } from 'vitest';
import {
  buildRecoveryReport,
  getRecoveryReportRoute,
  type RecoveryEvent,
} from '../../src/server/recovery-report.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<RecoveryEvent> = {}): RecoveryEvent {
  return {
    id: overrides.id ?? 'evt-1',
    source: overrides.source ?? 'github',
    status: overrides.status ?? 'accepted',
    receivedAt: overrides.receivedAt ?? '2025-01-15T10:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRecoveryReport', () => {
  it('returns zeros and null dates for empty events', () => {
    const report = buildRecoveryReport({
      events: [],
      dedupeKeyCount: 0,
      durationMs: 5,
    });

    expect(report.eventsRecovered).toBe(0);
    expect(report.dedupeKeysRecovered).toBe(0);
    expect(report.byStatus).toEqual({});
    expect(report.bySource).toEqual({});
    expect(report.oldestEventAt).toBeNull();
    expect(report.newestEventAt).toBeNull();
    expect(report.durationMs).toBe(5);
    expect(report.indexRebuildStats.totalIndexed).toBe(0);
    expect(report.indexRebuildStats.duplicatesSkipped).toBe(0);
    expect(report.indexRebuildStats.parseErrors).toBe(0);
    expect(report.recoveredAt).toBeTruthy();
  });

  it('handles a single event correctly', () => {
    const ev = makeEvent();
    const report = buildRecoveryReport({
      events: [ev],
      dedupeKeyCount: 1,
      durationMs: 12,
    });

    expect(report.eventsRecovered).toBe(1);
    expect(report.dedupeKeysRecovered).toBe(1);
    expect(report.byStatus).toEqual({ accepted: 1 });
    expect(report.bySource).toEqual({ github: 1 });
    expect(report.oldestEventAt).toBe(ev.receivedAt);
    expect(report.newestEventAt).toBe(ev.receivedAt);
  });

  it('computes correct byStatus and bySource for multiple events', () => {
    const events: RecoveryEvent[] = [
      makeEvent({ id: '1', source: 'github', status: 'accepted', receivedAt: '2025-01-15T10:00:00Z' }),
      makeEvent({ id: '2', source: 'api', status: 'rejected', receivedAt: '2025-01-15T11:00:00Z' }),
      makeEvent({ id: '3', source: 'github', status: 'accepted', receivedAt: '2025-01-15T12:00:00Z' }),
      makeEvent({ id: '4', source: 'api', status: 'ignored', receivedAt: '2025-01-15T13:00:00Z' }),
    ];

    const report = buildRecoveryReport({
      events,
      dedupeKeyCount: 3,
      durationMs: 42,
    });

    expect(report.eventsRecovered).toBe(4);
    expect(report.byStatus).toEqual({ accepted: 2, rejected: 1, ignored: 1 });
    expect(report.bySource).toEqual({ github: 2, api: 2 });
  });

  it('detects oldest and newest events correctly', () => {
    const events: RecoveryEvent[] = [
      makeEvent({ id: '1', receivedAt: '2025-03-10T08:00:00Z' }),
      makeEvent({ id: '2', receivedAt: '2025-01-01T00:00:00Z' }),
      makeEvent({ id: '3', receivedAt: '2025-06-20T23:59:59Z' }),
      makeEvent({ id: '4', receivedAt: '2025-03-10T09:00:00Z' }),
    ];

    const report = buildRecoveryReport({
      events,
      dedupeKeyCount: 0,
      durationMs: 10,
    });

    expect(report.oldestEventAt).toBe('2025-01-01T00:00:00Z');
    expect(report.newestEventAt).toBe('2025-06-20T23:59:59Z');
  });

  it('passes through durationMs', () => {
    const report = buildRecoveryReport({
      events: [makeEvent()],
      dedupeKeyCount: 0,
      durationMs: 999,
    });

    expect(report.durationMs).toBe(999);
  });

  it('counts parse errors', () => {
    const report = buildRecoveryReport({
      events: [makeEvent()],
      dedupeKeyCount: 0,
      durationMs: 5,
      parseErrors: 7,
    });

    expect(report.indexRebuildStats.parseErrors).toBe(7);
    expect(report.indexRebuildStats.totalIndexed).toBe(1);
  });

  it('counts duplicates skipped', () => {
    const report = buildRecoveryReport({
      events: [makeEvent()],
      dedupeKeyCount: 0,
      durationMs: 5,
      duplicatesSkipped: 3,
    });

    expect(report.indexRebuildStats.duplicatesSkipped).toBe(3);
  });

  it('handles mixed statuses with correct breakdown', () => {
    const statuses = ['accepted', 'rejected', 'accepted', 'ignored', 'rejected', 'rejected'];
    const events = statuses.map((status, i) =>
      makeEvent({ id: `e${i}`, status }),
    );

    const report = buildRecoveryReport({
      events,
      dedupeKeyCount: 2,
      durationMs: 15,
    });

    expect(report.byStatus).toEqual({ accepted: 2, rejected: 3, ignored: 1 });
    expect(report.eventsRecovered).toBe(6);
  });

  it('handles all events from same source', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `e${i}`, source: 'webhook' }),
    );

    const report = buildRecoveryReport({
      events,
      dedupeKeyCount: 0,
      durationMs: 1,
    });

    expect(report.bySource).toEqual({ webhook: 5 });
    expect(Object.keys(report.bySource)).toHaveLength(1);
  });

  it('handles all events with same status', () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      makeEvent({ id: `e${i}`, status: 'ignored', source: `src-${i}` }),
    );

    const report = buildRecoveryReport({
      events,
      dedupeKeyCount: 0,
      durationMs: 1,
    });

    expect(report.byStatus).toEqual({ ignored: 4 });
    expect(Object.keys(report.byStatus)).toHaveLength(1);
    expect(Object.keys(report.bySource)).toHaveLength(4);
  });

  it('defaults parseErrors and duplicatesSkipped to 0', () => {
    const report = buildRecoveryReport({
      events: [],
      dedupeKeyCount: 0,
      durationMs: 0,
    });

    expect(report.indexRebuildStats.parseErrors).toBe(0);
    expect(report.indexRebuildStats.duplicatesSkipped).toBe(0);
  });

  it('sets recoveredAt to a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    const report = buildRecoveryReport({
      events: [],
      dedupeKeyCount: 0,
      durationMs: 0,
    });
    const after = new Date().toISOString();

    expect(report.recoveredAt >= before).toBe(true);
    expect(report.recoveredAt <= after).toBe(true);
  });
});

describe('getRecoveryReportRoute', () => {
  it('returns correct method and path', () => {
    const route = getRecoveryReportRoute();
    expect(route.method).toBe('get');
    expect(route.path).toBe('/recovery/report');
  });
});
