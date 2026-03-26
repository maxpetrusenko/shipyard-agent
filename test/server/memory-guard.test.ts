import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryGuard, MEMORY_METRICS } from '../../src/server/memory-guard.js';
import type { MemoryPressure, PressureLevel } from '../../src/server/memory-guard.js';

describe('MemoryGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // check() returns valid MemoryPressure
  // -------------------------------------------------------------------------

  it('check() returns valid MemoryPressure with all required fields', () => {
    const guard = new MemoryGuard({ elevatedMB: 512, criticalMB: 1024 });
    const snap = guard.check();

    expect(snap).toHaveProperty('heapUsedMB');
    expect(snap).toHaveProperty('heapTotalMB');
    expect(snap).toHaveProperty('rssMemMB');
    expect(snap).toHaveProperty('eventCount');
    expect(snap).toHaveProperty('queueDepth');
    expect(snap).toHaveProperty('pressure');
    expect(snap).toHaveProperty('thresholds');

    expect(typeof snap.heapUsedMB).toBe('number');
    expect(typeof snap.heapTotalMB).toBe('number');
    expect(typeof snap.rssMemMB).toBe('number');
    expect(typeof snap.eventCount).toBe('number');
    expect(typeof snap.queueDepth).toBe('number');
    expect(snap.heapUsedMB).toBeGreaterThan(0);
    expect(snap.rssMemMB).toBeGreaterThan(0);
    expect(snap.thresholds.elevated).toBe(512);
    expect(snap.thresholds.critical).toBe(1024);
  });

  it('derives default thresholds from heap size limit percentages', () => {
    const guard = new MemoryGuard({ heapSizeLimitMB: 256 });
    const snap = guard.check();
    expect(snap.thresholds.elevated).toBe(179.2);
    expect(snap.thresholds.critical).toBe(230.4);
  });

  it('check() uses injected getEventCount and getQueueDepth', () => {
    const guard = new MemoryGuard({
      getEventCount: () => 42,
      getQueueDepth: () => 7,
    });
    const snap = guard.check();
    expect(snap.eventCount).toBe(42);
    expect(snap.queueDepth).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Threshold classification
  // -------------------------------------------------------------------------

  it('classifies as normal when heap below elevated threshold', () => {
    // Set thresholds absurdly high so real heap is always "normal"
    const guard = new MemoryGuard({ elevatedMB: 999_999, criticalMB: 999_999 });
    expect(guard.check().pressure).toBe('normal');
  });

  it('classifies as elevated when heap >= elevated and < critical', () => {
    // Set elevated to 0 (always above), critical very high
    const guard = new MemoryGuard({ elevatedMB: 0, criticalMB: 999_999 });
    expect(guard.check().pressure).toBe('elevated');
  });

  it('classifies as critical when heap >= critical threshold', () => {
    // Both thresholds at 0 so any heap use is critical
    const guard = new MemoryGuard({ elevatedMB: 0, criticalMB: 0 });
    expect(guard.check().pressure).toBe('critical');
  });

  // -------------------------------------------------------------------------
  // Pressure change callback
  // -------------------------------------------------------------------------

  it('fires pressure change callback on transition', () => {
    const transitions: PressureLevel[] = [];
    const guard = new MemoryGuard({
      elevatedMB: 0,
      criticalMB: 999_999,
      intervalMs: 10,
    });
    guard.onPressureChange((p: MemoryPressure) => {
      transitions.push(p.pressure);
    });

    // Manually trigger internal tick (which does the check + diff)
    // The guard starts at 'normal'; with elevated=0, first tick transitions to 'elevated'
    (guard as unknown as { tick: () => void }).tick();
    expect(transitions).toContain('elevated');
  });

  it('does not fire callback when pressure level stays the same', () => {
    let callCount = 0;
    const guard = new MemoryGuard({
      elevatedMB: 999_999,
      criticalMB: 999_999,
      intervalMs: 10,
    });
    guard.onPressureChange(() => {
      callCount++;
    });

    // Both ticks should stay "normal" — no transition
    (guard as unknown as { tick: () => void }).tick();
    (guard as unknown as { tick: () => void }).tick();
    expect(callCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // start / stop lifecycle
  // -------------------------------------------------------------------------

  it('start() begins interval and stop() clears it', async () => {
    const guard = new MemoryGuard({ intervalMs: 20 });
    guard.start();

    // Calling start again is a no-op
    guard.start();

    // Let a tick fire
    await new Promise((r) => setTimeout(r, 50));

    guard.stop();

    // Double stop is safe
    guard.stop();
  });

  // -------------------------------------------------------------------------
  // gauges()
  // -------------------------------------------------------------------------

  it('gauges() returns event backlog and queue depth', () => {
    const guard = new MemoryGuard({
      getEventCount: () => 100,
      getQueueDepth: () => 5,
    });
    const g = guard.gauges();
    expect(g[MEMORY_METRICS.EVENTS_BACKLOG_SIZE]).toBe(100);
    expect(g[MEMORY_METRICS.QUEUE_DEPTH]).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Critical pressure logs to stderr
  // -------------------------------------------------------------------------

  it('logs to stderr on critical transition', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guard = new MemoryGuard({
      elevatedMB: 0,
      criticalMB: 0,
      intervalMs: 100,
    });
    (guard as unknown as { tick: () => void }).tick();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[memory-guard] CRITICAL'),
    );
  });
});
