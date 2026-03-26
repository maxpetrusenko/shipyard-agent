/**
 * Regression tests for DedupeStore persistence and EventPersistence rebuild.
 *
 * Covers disk round-trips, TTL expiry on reload, max entries enforcement,
 * concurrent writes, graceful degradation on corrupt/empty files,
 * hydrate index rebuild, and age/count-based retention.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DedupeStore } from '../../src/server/dedupe-store.js';
import type { DedupeEntry } from '../../src/server/dedupe-store.js';
import { EventPersistence } from '../../src/server/event-persistence.js';
import type { PersistedInvokeEvent } from '../../src/server/event-persistence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function tmpDir(prefix = 'shipyard-regress-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function tmpFile(prefix?: string): string {
  const d = tmpDir(prefix);
  return join(d, 'dedupe.json');
}

function makeDedupeEntry(overrides?: Partial<DedupeEntry>): DedupeEntry {
  return {
    eventId: randomUUID(),
    deliveryId: randomUUID(),
    eventType: 'push',
    receivedAt: new Date().toISOString(),
    ttlMs: 0,
    ...overrides,
  };
}

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

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

// ===========================================================================
// DedupeStore regression tests
// ===========================================================================

describe('DedupeStore regression', () => {
  const stores: DedupeStore[] = [];
  function create(opts?: ConstructorParameters<typeof DedupeStore>[0]): DedupeStore {
    const s = new DedupeStore(opts);
    stores.push(s);
    return s;
  }

  afterEach(() => {
    for (const s of stores) s.destroy();
    stores.length = 0;
  });

  // 1. Persist + reload
  it('persist to disk then reload into a new store preserves all entries', () => {
    const file = tmpFile();
    const storeA = create({ filePath: file, ttlMs: 300_000, persistDebounceMs: 0 });

    const entries: Array<[string, DedupeEntry]> = [];
    for (let i = 0; i < 5; i++) {
      const key = `key-${i}`;
      const entry = makeDedupeEntry({ eventId: `evt-${i}` });
      entries.push([key, entry]);
      storeA.set(key, entry);
    }
    storeA.persistToDisk();

    const storeB = create({ filePath: file, ttlMs: 300_000 });
    storeB.loadFromDisk();

    expect(storeB.size).toBe(5);
    for (const [key, entry] of entries) {
      expect(storeB.has(key)).toBe(true);
      expect(storeB.get(key)!.eventId).toBe(entry.eventId);
    }
  });

  // 2. TTL expiry on reload
  it('entries with expired TTL are filtered out on loadFromDisk', () => {
    const file = tmpFile();
    const storeA = create({ filePath: file, ttlMs: 50, persistDebounceMs: 0 });

    // Entry that will be expired by the time we reload (TTL=50ms, receivedAt in the past)
    storeA.set('will-expire', makeDedupeEntry({
      receivedAt: new Date(Date.now() - 200).toISOString(),
      ttlMs: 50,
    }));
    // Entry that stays alive
    storeA.set('stays-alive', makeDedupeEntry({
      receivedAt: new Date().toISOString(),
      ttlMs: 300_000,
    }));
    storeA.persistToDisk();

    const storeB = create({ filePath: file, ttlMs: 300_000 });
    storeB.loadFromDisk();

    expect(storeB.has('will-expire')).toBe(false);
    expect(storeB.has('stays-alive')).toBe(true);
    expect(storeB.size).toBe(1);
  });

  // 3. Max entries enforcement
  it('adding more than maxEntries evicts the oldest entries', () => {
    const store = create({ filePath: null, ttlMs: 300_000, maxEntries: 5 });

    for (let i = 0; i < 10; i++) {
      store.set(`k-${i}`, makeDedupeEntry({
        receivedAt: new Date(Date.now() + i * 100).toISOString(),
      }));
    }

    expect(store.size).toBe(5);
    // Oldest (k-0 through k-4) should be evicted
    for (let i = 0; i < 5; i++) {
      expect(store.has(`k-${i}`)).toBe(false);
    }
    // Newest (k-5 through k-9) should remain
    for (let i = 5; i < 10; i++) {
      expect(store.has(`k-${i}`)).toBe(true);
    }
  });

  // 4. Concurrent sets don't corrupt
  it('rapid set() calls followed by persist and reload produce consistent state', () => {
    const file = tmpFile();
    const store = create({ filePath: file, ttlMs: 300_000, maxEntries: 1000, persistDebounceMs: 0 });

    const keys: string[] = [];
    for (let i = 0; i < 100; i++) {
      const key = `rapid-${i}`;
      keys.push(key);
      store.set(key, makeDedupeEntry({ eventId: `evt-${i}` }));
    }
    store.persistToDisk();

    const storeB = create({ filePath: file, ttlMs: 300_000, maxEntries: 1000 });
    storeB.loadFromDisk();

    expect(storeB.size).toBe(100);
    for (const key of keys) {
      expect(storeB.has(key)).toBe(true);
      const entry = storeB.get(key);
      expect(entry).toBeTruthy();
      expect(typeof entry!.eventId).toBe('string');
      expect(typeof entry!.deliveryId).toBe('string');
      expect(typeof entry!.receivedAt).toBe('string');
    }
  });

  // 5. Empty file graceful
  it('loadFromDisk handles an empty file without crashing', () => {
    const file = tmpFile();
    writeFileSync(file, '');

    const store = create({ filePath: file, ttlMs: 300_000 });
    // Should not throw
    expect(() => store.loadFromDisk()).not.toThrow();
    expect(store.size).toBe(0);
  });

  // 6. Malformed JSON graceful
  it('loadFromDisk handles malformed JSON without crashing', () => {
    const file = tmpFile();
    writeFileSync(file, '<<<garbage>>>{{{{not json at all}}}}');

    const store = create({ filePath: file, ttlMs: 300_000 });
    expect(() => store.loadFromDisk()).not.toThrow();
    expect(store.size).toBe(0);
  });

  // 7. Evict removes expired entries
  it('evict() removes entries whose receivedAt + ttlMs is in the past', () => {
    const store = create({ filePath: null, ttlMs: 100 });

    // 3 expired entries
    for (let i = 0; i < 3; i++) {
      store.set(`expired-${i}`, makeDedupeEntry({
        receivedAt: new Date(Date.now() - 500).toISOString(),
        ttlMs: 100,
      }));
    }
    // 2 fresh entries
    for (let i = 0; i < 2; i++) {
      store.set(`fresh-${i}`, makeDedupeEntry({
        receivedAt: new Date().toISOString(),
        ttlMs: 300_000,
      }));
    }

    // All 5 are in the map (expired ones not checked yet)
    expect(store.size).toBe(5);

    const removed = store.evict();
    expect(removed).toBe(3);
    expect(store.size).toBe(2);

    for (let i = 0; i < 3; i++) {
      expect(store.has(`expired-${i}`)).toBe(false);
    }
    for (let i = 0; i < 2; i++) {
      expect(store.has(`fresh-${i}`)).toBe(true);
    }
  });
});

// ===========================================================================
// EventPersistence regression tests
// ===========================================================================

describe('EventPersistence regression', () => {
  // 8. Persist + load round-trip
  it('persistEvent followed by loadEventsFromFiles returns matching event', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    const event = makeEvent({
      source: 'github_webhook',
      eventType: 'pull_request',
      status: 'accepted',
      reason: 'auto-merge',
      runId: 'run-abc',
      metadata: { pr: 42, repo: 'owner/repo' },
    });
    ep.persistEvent(event);

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(1);

    const got = loaded[0]!;
    expect(got.id).toBe(event.id);
    expect(got.source).toBe('github_webhook');
    expect(got.eventType).toBe('pull_request');
    expect(got.status).toBe('accepted');
    expect(got.reason).toBe('auto-merge');
    expect(got.runId).toBe('run-abc');
    expect(got.metadata).toEqual({ pr: 42, repo: 'owner/repo' });
    expect(got.receivedAt).toBe(event.receivedAt);
  });

  // 9. Hydrate rebuilds index
  it('hydrate rebuilds index with events sorted newest-first and dedupeSet populated', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    const timestamps = [
      '2025-01-01T00:00:00.000Z',
      '2025-06-15T12:00:00.000Z',
      '2025-03-10T06:00:00.000Z',
    ];
    const events = timestamps.map((ts) => makeEvent({ receivedAt: ts }));
    for (const e of events) {
      ep.persistEvent(e);
    }

    const index = ep.hydrate();

    // Should be sorted newest-first
    expect(index.events).toHaveLength(3);
    expect(index.events[0]!.receivedAt).toBe('2025-06-15T12:00:00.000Z');
    expect(index.events[1]!.receivedAt).toBe('2025-03-10T06:00:00.000Z');
    expect(index.events[2]!.receivedAt).toBe('2025-01-01T00:00:00.000Z');

    // DedupeSet should contain all ids
    for (const e of events) {
      expect(index.dedupeSet.has(e.id)).toBe(true);
    }
    expect(index.dedupeSet.size).toBe(3);

    // hasEvent should work via the index
    expect(ep.hasEvent(events[0]!.id)).toBe(true);
    expect(ep.hasEvent('nonexistent-id')).toBe(false);
  });

  // 10. Retention age-based
  it('runRetention removes events older than retentionHours', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    const now = new Date();
    // "old" event: 48 hours ago
    const oldEvent = makeEvent({
      receivedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    });
    // "recent" event: 1 hour ago
    const recentEvent = makeEvent({
      receivedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    });

    ep.persistEvent(oldEvent);
    ep.persistEvent(recentEvent);
    ep.hydrate();

    // Retain only events from the last 24 hours
    const purged = ep.runRetention({ retentionHours: 24, maxCount: 10_000 });
    expect(purged).toBe(1);

    const index = ep.getIndex();
    expect(index.events).toHaveLength(1);
    expect(index.events[0]!.id).toBe(recentEvent.id);
    expect(index.dedupeSet.has(oldEvent.id)).toBe(false);
    expect(index.dedupeSet.has(recentEvent.id)).toBe(true);

    // Verify file was deleted from disk
    const filesOnDisk = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(filesOnDisk).toHaveLength(1);
    expect(filesOnDisk[0]).toBe(`${recentEvent.id}.json`);
  });

  // 11. Retention count-based
  it('runRetention trims to maxCount keeping newest events', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    const events: PersistedInvokeEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const e = makeEvent({
        receivedAt: new Date(Date.now() - (10 - i) * 1000).toISOString(),
      });
      events.push(e);
      ep.persistEvent(e);
    }
    ep.hydrate();

    // Keep only 3 newest
    const purged = ep.runRetention({ retentionHours: 999, maxCount: 3 });
    expect(purged).toBe(7);

    const index = ep.getIndex();
    expect(index.events).toHaveLength(3);

    // The 3 newest events (indices 7, 8, 9) should survive
    const survivingIds = new Set(index.events.map((e) => e.id));
    for (let i = 7; i < 10; i++) {
      expect(survivingIds.has(events[i]!.id)).toBe(true);
    }
    // Oldest should be gone
    for (let i = 0; i < 7; i++) {
      expect(survivingIds.has(events[i]!.id)).toBe(false);
    }

    // Verify disk matches
    const filesOnDisk = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(filesOnDisk).toHaveLength(3);
  });

  // 12. Missing directory graceful
  it('loadEventsFromFiles returns empty array for nonexistent directory', () => {
    const ep = new EventPersistence('/tmp/shipyard-no-such-dir-regress-xyz', {
      forceFileEnabled: true,
    });
    const loaded = ep.loadEventsFromFiles('/tmp/shipyard-no-such-dir-regress-xyz');
    expect(loaded).toEqual([]);
  });

  // 13. Corrupt file skipped
  it('loadEventsFromFiles skips corrupt JSON but loads valid files', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    // Persist two valid events
    const goodEvent1 = makeEvent({ source: 'good-1' });
    const goodEvent2 = makeEvent({ source: 'good-2' });
    ep.persistEvent(goodEvent1);
    ep.persistEvent(goodEvent2);

    // Write several corrupt files
    writeFileSync(join(dir, 'corrupt-1.json'), '{{invalid json');
    writeFileSync(join(dir, 'corrupt-2.json'), '');
    writeFileSync(join(dir, 'corrupt-3.json'), 'null');

    const loaded = ep.loadEventsFromFiles(dir);
    expect(loaded).toHaveLength(2);

    const ids = loaded.map((e) => e.id);
    expect(ids).toContain(goodEvent1.id);
    expect(ids).toContain(goodEvent2.id);
  });

  // 14. Hydrate is idempotent (can be called multiple times safely)
  it('hydrate can be called multiple times and replaces previous state', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    ep.persistEvent(makeEvent({ source: 'first-batch' }));
    const index1 = ep.hydrate();
    expect(index1.events).toHaveLength(1);

    ep.persistEvent(makeEvent({ source: 'second-batch' }));
    const index2 = ep.hydrate();
    expect(index2.events).toHaveLength(2);
    expect(index2.dedupeSet.size).toBe(2);
  });

  // 15. Retention with both age + count acting together
  it('runRetention applies both age and count policies in one pass', () => {
    const dir = tmpDir();
    const ep = new EventPersistence(dir, { forceFileEnabled: true });

    const now = Date.now();
    // 5 old events (72h ago)
    for (let i = 0; i < 5; i++) {
      ep.persistEvent(makeEvent({
        receivedAt: new Date(now - 72 * 60 * 60 * 1000 - i * 1000).toISOString(),
      }));
    }
    // 8 recent events (1h ago, staggered)
    const recentEvents: PersistedInvokeEvent[] = [];
    for (let i = 0; i < 8; i++) {
      const e = makeEvent({
        receivedAt: new Date(now - 60 * 60 * 1000 + i * 1000).toISOString(),
      });
      recentEvents.push(e);
      ep.persistEvent(e);
    }
    ep.hydrate();

    // Age cutoff: 24h -> removes 5 old events
    // Count cutoff: 3 -> trims 8 recent to 3
    const purged = ep.runRetention({ retentionHours: 24, maxCount: 3 });
    expect(purged).toBe(10); // 5 old + 5 recent trimmed

    const index = ep.getIndex();
    expect(index.events).toHaveLength(3);

    // Only the 3 newest recent events survive
    const survivingIds = new Set(index.events.map((e) => e.id));
    for (let i = 5; i < 8; i++) {
      expect(survivingIds.has(recentEvents[i]!.id)).toBe(true);
    }
  });
});
