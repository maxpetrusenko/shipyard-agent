import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DedupeStore } from '../../src/server/dedupe-store.js';
import type { DedupeEntry } from '../../src/server/dedupe-store.js';

function tmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-dedupe-'));
  return join(dir, 'dedupe.json');
}

function makeEntry(overrides?: Partial<DedupeEntry>): DedupeEntry {
  return {
    eventId: 'evt-1',
    deliveryId: 'del-1',
    eventType: 'issue_comment',
    receivedAt: new Date().toISOString(),
    ttlMs: 0,
    ...overrides,
  };
}

describe('DedupeStore', () => {
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

  it('set + has returns true for live keys', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    store.set('k1', makeEntry());
    expect(store.has('k1')).toBe(true);
    expect(store.has('k2')).toBe(false);
  });

  it('get returns entry for live keys', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    const entry = makeEntry({ eventId: 'abc' });
    store.set('k1', entry);
    const result = store.get('k1');
    expect(result).toBeTruthy();
    expect(result!.eventId).toBe('abc');
  });

  it('delete removes a key', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    store.set('k1', makeEntry());
    expect(store.has('k1')).toBe(true);
    store.delete('k1');
    expect(store.has('k1')).toBe(false);
  });

  it('size reflects live entries', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    expect(store.size).toBe(0);
    store.set('a', makeEntry());
    store.set('b', makeEntry());
    expect(store.size).toBe(2);
  });

  it('has returns false for expired entries', () => {
    const store = create({ filePath: null, ttlMs: 100 });
    const pastEntry = makeEntry({
      receivedAt: new Date(Date.now() - 200).toISOString(),
    });
    store.set('old', pastEntry);
    expect(store.has('old')).toBe(false);
  });

  it('get returns null for expired entries', () => {
    const store = create({ filePath: null, ttlMs: 100 });
    const pastEntry = makeEntry({
      receivedAt: new Date(Date.now() - 200).toISOString(),
    });
    store.set('old', pastEntry);
    expect(store.get('old')).toBeNull();
  });

  it('evict removes expired entries', () => {
    const store = create({ filePath: null, ttlMs: 100 });
    store.set('old', makeEntry({
      receivedAt: new Date(Date.now() - 200).toISOString(),
    }));
    store.set('fresh', makeEntry());
    const removed = store.evict();
    expect(removed).toBe(1);
    expect(store.size).toBe(1);
    expect(store.has('fresh')).toBe(true);
  });

  it('enforces maxEntries by evicting oldest', () => {
    const store = create({ filePath: null, ttlMs: 60_000, maxEntries: 3 });
    store.set('a', makeEntry({ receivedAt: new Date(Date.now() - 3000).toISOString() }));
    store.set('b', makeEntry({ receivedAt: new Date(Date.now() - 2000).toISOString() }));
    store.set('c', makeEntry({ receivedAt: new Date(Date.now() - 1000).toISOString() }));
    // 4th entry should evict 'a'
    store.set('d', makeEntry({ receivedAt: new Date().toISOString() }));
    expect(store.size).toBe(3);
    expect(store.has('a')).toBe(false);
    expect(store.has('b')).toBe(true);
    expect(store.has('d')).toBe(true);
  });

  it('persistToDisk + loadFromDisk round-trip', () => {
    const file = tmpFile();
    const a = create({ filePath: file, ttlMs: 60_000, persistDebounceMs: 0 });
    a.set('k1', makeEntry({ eventId: 'e1' }));
    a.set('k2', makeEntry({ eventId: 'e2' }));
    a.flush();

    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).toContain('"k1"');

    const b = create({ filePath: file, ttlMs: 60_000 });
    b.loadFromDisk();
    expect(b.has('k1')).toBe(true);
    expect(b.has('k2')).toBe(true);
    expect(b.get('k1')!.eventId).toBe('e1');
  });

  it('loadFromDisk filters expired entries', () => {
    const file = tmpFile();
    const a = create({ filePath: file, ttlMs: 60_000, persistDebounceMs: 0 });
    a.set('live', makeEntry({ receivedAt: new Date().toISOString() }));
    a.set('dead', makeEntry({
      receivedAt: new Date(Date.now() - 120_000).toISOString(),
      ttlMs: 60_000,
    }));
    a.flush();

    const b = create({ filePath: file, ttlMs: 60_000 });
    b.loadFromDisk();
    expect(b.has('live')).toBe(true);
    expect(b.has('dead')).toBe(false);
  });

  it('loadFromDisk enforces maxEntries', () => {
    const file = tmpFile();
    const a = create({ filePath: file, ttlMs: 60_000, maxEntries: 100, persistDebounceMs: 0 });
    for (let i = 0; i < 10; i++) {
      a.set(`k${i}`, makeEntry({
        eventId: `e${i}`,
        receivedAt: new Date(Date.now() - (10 - i) * 1000).toISOString(),
      }));
    }
    a.flush();

    const b = create({ filePath: file, ttlMs: 60_000, maxEntries: 5 });
    b.loadFromDisk();
    expect(b.size).toBe(5);
    // Oldest should be evicted, newest kept
    expect(b.has('k9')).toBe(true);
    expect(b.has('k0')).toBe(false);
  });

  it('handles missing file gracefully', () => {
    const store = create({ filePath: '/tmp/nonexistent-dedupe-xyz.json', ttlMs: 60_000 });
    // Should not throw
    store.loadFromDisk();
    expect(store.size).toBe(0);
  });

  it('handles corrupt file gracefully', () => {
    const file = tmpFile();
    const { writeFileSync: wf } = require('node:fs');
    wf(file, 'not-json!!!');
    const store = create({ filePath: file, ttlMs: 60_000 });
    // Should not throw
    store.loadFromDisk();
    expect(store.size).toBe(0);
  });

  it('entry-level ttlMs overrides store default', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    // Entry with very short TTL, already expired
    store.set('short', makeEntry({
      receivedAt: new Date(Date.now() - 500).toISOString(),
      ttlMs: 100,
    }));
    expect(store.has('short')).toBe(false);

    // Entry with long TTL, still valid
    store.set('long', makeEntry({
      receivedAt: new Date(Date.now() - 30_000).toISOString(),
      ttlMs: 120_000,
    }));
    expect(store.has('long')).toBe(true);
  });

  it('flush writes immediately and clears timer', () => {
    const file = tmpFile();
    const store = create({ filePath: file, ttlMs: 60_000, persistDebounceMs: 30_000 });
    store.set('k1', makeEntry());
    // Without flush, file may not exist yet (debounced)
    store.flush();
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).toContain('"k1"');
  });

  it('null filePath disables persistence', () => {
    const store = create({ filePath: null, ttlMs: 60_000 });
    store.set('k1', makeEntry());
    // Should not throw
    store.persistToDisk();
    store.flush();
  });

  it('destroy flushes pending entries to disk before shutdown', () => {
    const file = tmpFile();
    const store = create({ filePath: file, ttlMs: 60_000, persistDebounceMs: 60_000 });
    store.set('k1', makeEntry({ eventId: 'persist-1' }));
    store.set('k2', makeEntry({ eventId: 'persist-2' }));
    store.destroy();
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).toContain('"k1"');
    expect(raw).toContain('"k2"');
  });
});
