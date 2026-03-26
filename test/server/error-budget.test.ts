import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeErrorBudget,
  getErrorBudgetRoute,
  type ErrorBudgetEvent,
  type ErrorBudgetSnapshot,
} from '../../src/server/error-budget.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an event at `agoMs` milliseconds before now. */
function makeEvent(
  status: string,
  agoMs: number,
  metadata?: Record<string, unknown>,
): ErrorBudgetEvent {
  return {
    status,
    receivedAt: new Date(Date.now() - agoMs).toISOString(),
    metadata,
  };
}

describe('computeErrorBudget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Empty events -> healthy, all zeros
  it('returns healthy snapshot with all zeros for empty events', () => {
    const snap = computeErrorBudget([]);
    expect(snap.status).toBe('healthy');
    expect(snap.failureRate5m).toBe(0);
    expect(snap.queueFullRate5m).toBe(0);
    expect(snap.totalEvents5m).toBe(0);
    expect(snap.totalFailures5m).toBe(0);
    expect(snap.totalQueueFull5m).toBe(0);
    expect(snap.budgetRemaining).toBe(1);
    expect(snap.windowMs).toBe(300_000);
    expect(snap.computedAt).toBeTruthy();
  });

  // 2. All accepted -> healthy, 0 failure rate
  it('returns healthy with zero failure rate when all events accepted', () => {
    const events = [
      makeEvent('accepted', 60_000),
      makeEvent('accepted', 120_000),
      makeEvent('accepted', 180_000),
    ];
    const snap = computeErrorBudget(events);
    expect(snap.status).toBe('healthy');
    expect(snap.failureRate5m).toBe(0);
    expect(snap.totalEvents5m).toBe(3);
    expect(snap.totalFailures5m).toBe(0);
    expect(snap.budgetRemaining).toBe(1);
  });

  // 3. Mixed events in 5min window -> correct rates
  it('computes correct rates for mixed accepted/rejected events', () => {
    const events = [
      makeEvent('accepted', 30_000),
      makeEvent('accepted', 60_000),
      makeEvent('accepted', 90_000),
      makeEvent('rejected', 120_000),
    ];
    const snap = computeErrorBudget(events);
    expect(snap.totalEvents5m).toBe(4);
    expect(snap.totalFailures5m).toBe(1);
    expect(snap.failureRate5m).toBe(0.25);
    expect(snap.budgetRemaining).toBe(0.75);
    expect(snap.status).toBe('critical'); // 25% >= 20%
  });

  // 4. Events outside window excluded
  it('excludes events outside the time window', () => {
    const events = [
      makeEvent('rejected', 10_000),      // inside (10s ago)
      makeEvent('accepted', 60_000),       // inside (1min ago)
      makeEvent('rejected', 400_000),      // outside (6m40s ago)
      makeEvent('rejected', 600_000),      // outside (10min ago)
    ];
    const snap = computeErrorBudget(events);
    expect(snap.totalEvents5m).toBe(2);
    expect(snap.totalFailures5m).toBe(1);
    expect(snap.failureRate5m).toBe(0.5);
  });

  // 5. Warning threshold (5-20% failures)
  it('returns warning status for failure rate between 5% and 20%', () => {
    // 1 rejected out of 10 = 10% failure rate
    const events: ErrorBudgetEvent[] = [];
    for (let i = 0; i < 9; i++) {
      events.push(makeEvent('accepted', (i + 1) * 10_000));
    }
    events.push(makeEvent('rejected', 100_000));
    const snap = computeErrorBudget(events);
    expect(snap.failureRate5m).toBe(0.1);
    expect(snap.status).toBe('warning');
  });

  // 6. Critical threshold (>= 20% failures)
  it('returns critical status for failure rate at or above 20%', () => {
    // 2 rejected out of 10 = exactly 20%
    const events: ErrorBudgetEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(makeEvent('accepted', (i + 1) * 10_000));
    }
    events.push(makeEvent('rejected', 90_000));
    events.push(makeEvent('rejected', 100_000));
    const snap = computeErrorBudget(events);
    expect(snap.failureRate5m).toBe(0.2);
    expect(snap.status).toBe('critical');
  });

  // 7. Queue-full rate computation
  it('detects queue-full events from metadata code field', () => {
    const events = [
      makeEvent('rejected', 10_000, { code: 'QUEUE_FULL' }),
      makeEvent('rejected', 20_000, { error: 'Queue full' }),
      makeEvent('accepted', 30_000),
      makeEvent('accepted', 40_000),
      makeEvent('rejected', 50_000, { reason: 'queue depth exceeded' }),
    ];
    const snap = computeErrorBudget(events);
    expect(snap.totalQueueFull5m).toBe(3);
    expect(snap.queueFullRate5m).toBe(3 / 5);
    expect(snap.totalFailures5m).toBe(3); // 3 rejected
  });

  // 8. Budget remaining calculation
  it('computes budgetRemaining as 1 minus failureRate', () => {
    // 3 rejected out of 5 = 60% failure rate
    const events = [
      makeEvent('rejected', 10_000),
      makeEvent('rejected', 20_000),
      makeEvent('rejected', 30_000),
      makeEvent('accepted', 40_000),
      makeEvent('accepted', 50_000),
    ];
    const snap = computeErrorBudget(events);
    expect(snap.failureRate5m).toBe(0.6);
    expect(snap.budgetRemaining).toBeCloseTo(0.4, 10);
  });

  // 9. Custom window size
  it('respects custom windowMs parameter', () => {
    const events = [
      makeEvent('rejected', 5_000),   // inside 10s window
      makeEvent('accepted', 8_000),   // inside 10s window
      makeEvent('rejected', 15_000),  // outside 10s window
    ];
    const snap = computeErrorBudget(events, 10_000);
    expect(snap.windowMs).toBe(10_000);
    expect(snap.totalEvents5m).toBe(2);
    expect(snap.totalFailures5m).toBe(1);
    expect(snap.failureRate5m).toBe(0.5);
  });

  // 10. All rejected -> critical, 1.0 failure rate
  it('returns critical with 1.0 failure rate when all events rejected', () => {
    const events = [
      makeEvent('rejected', 10_000),
      makeEvent('rejected', 20_000),
      makeEvent('rejected', 30_000),
    ];
    const snap = computeErrorBudget(events);
    expect(snap.status).toBe('critical');
    expect(snap.failureRate5m).toBe(1);
    expect(snap.budgetRemaining).toBe(0);
    expect(snap.totalEvents5m).toBe(3);
    expect(snap.totalFailures5m).toBe(3);
  });

  // 11. Boundary: exactly at warning threshold (5%)
  it('returns warning at exactly 5% failure rate', () => {
    // 1 rejected out of 20 = 5%
    const events: ErrorBudgetEvent[] = [];
    for (let i = 0; i < 19; i++) {
      events.push(makeEvent('accepted', (i + 1) * 5_000));
    }
    events.push(makeEvent('rejected', 100_000));
    const snap = computeErrorBudget(events);
    expect(snap.failureRate5m).toBe(0.05);
    expect(snap.status).toBe('warning');
  });

  // 12. Invalid receivedAt timestamps are excluded
  it('excludes events with invalid receivedAt', () => {
    const events: ErrorBudgetEvent[] = [
      makeEvent('accepted', 10_000),
      { status: 'rejected', receivedAt: 'not-a-date' },
      { status: 'rejected', receivedAt: '' },
    ];
    const snap = computeErrorBudget(events);
    expect(snap.totalEvents5m).toBe(1);
    expect(snap.totalFailures5m).toBe(0);
  });
});

describe('getErrorBudgetRoute', () => {
  it('returns correct route descriptor', () => {
    const route = getErrorBudgetRoute();
    expect(route.method).toBe('get');
    expect(route.path).toBe('/invoke/events/error-budget');
    expect(typeof route.handler).toBe('function');
  });

  it('handler delegates to computeErrorBudget', () => {
    const route = getErrorBudgetRoute();
    const events = [makeEvent('accepted', 10_000), makeEvent('rejected', 20_000)];
    const snap = route.handler(events);
    expect(snap.totalEvents5m).toBe(2);
    expect(snap.totalFailures5m).toBe(1);
    expect(snap.failureRate5m).toBe(0.5);
    expect(snap.status).toBe('critical');
  });
});
