/**
 * Extended ContextStore tests.
 *
 * The root test/context-store.test.ts covers core behavior; this file
 * adds tests for dedup by label, ordering, and source filtering.
 */

import { describe, it, expect } from 'vitest';
import { ContextStore } from '../../src/context/store.js';
import { buildSystemContext } from '../../src/context/injector.js';

// ---------------------------------------------------------------------------
// Add / remove / getAll
// ---------------------------------------------------------------------------

describe('ContextStore add/remove/getAll', () => {
  it('adds entries with different labels', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'alpha', source: 'user' });
    store.add({ label: 'B', content: 'beta', source: 'system' });
    store.add({ label: 'C', content: 'gamma', source: 'tool' });

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.label)).toEqual(['A', 'B', 'C']);
  });

  it('remove returns true for existing, false for missing', () => {
    const store = new ContextStore();
    store.add({ label: 'X', content: 'data', source: 'user' });

    expect(store.remove('X')).toBe(true);
    expect(store.remove('X')).toBe(false);
    expect(store.remove('never-existed')).toBe(false);
  });

  it('getAll returns empty array initially', () => {
    const store = new ContextStore();
    expect(store.getAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dedup by label
// ---------------------------------------------------------------------------

describe('dedup by label', () => {
  it('overwrites entry with same label', () => {
    const store = new ContextStore();
    store.add({ label: 'cfg', content: 'v1', source: 'user' });
    store.add({ label: 'cfg', content: 'v2', source: 'tool' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.get('cfg')?.content).toBe('v2');
    expect(store.get('cfg')?.source).toBe('tool');
  });

  it('preserves other entries when overwriting', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'a', source: 'user' });
    store.add({ label: 'B', content: 'b1', source: 'user' });
    store.add({ label: 'B', content: 'b2', source: 'system' });

    expect(store.getAll()).toHaveLength(2);
    expect(store.get('A')?.content).toBe('a');
    expect(store.get('B')?.content).toBe('b2');
  });

  it('repeated adds and removes work correctly', () => {
    const store = new ContextStore();
    store.add({ label: 'X', content: '1', source: 'user' });
    store.add({ label: 'X', content: '2', source: 'user' });
    store.remove('X');
    store.add({ label: 'X', content: '3', source: 'user' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.get('X')?.content).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('removes all entries', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'a', source: 'user' });
    store.add({ label: 'B', content: 'b', source: 'user' });
    store.add({ label: 'C', content: 'c', source: 'user' });
    store.clear();

    expect(store.getAll()).toHaveLength(0);
    expect(store.get('A')).toBeUndefined();
  });

  it('allows adding after clear', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'a', source: 'user' });
    store.clear();
    store.add({ label: 'B', content: 'b', source: 'user' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.get('B')?.content).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

describe('toMarkdown', () => {
  it('returns markdown with section headers', () => {
    const store = new ContextStore();
    store.add({ label: 'Rules', content: 'Be concise', source: 'user' });
    store.add({ label: 'Config', content: 'port=3000', source: 'system' });

    const md = store.toMarkdown();
    expect(md).toContain('## Rules');
    expect(md).toContain('Be concise');
    expect(md).toContain('## Config');
    expect(md).toContain('port=3000');
    expect(md).toContain('---');
  });

  it('returns empty string for empty store', () => {
    const store = new ContextStore();
    expect(store.toMarkdown()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildSystemContext integration
// ---------------------------------------------------------------------------

describe('buildSystemContext', () => {
  it('returns empty string when store is empty', () => {
    const store = new ContextStore();
    expect(buildSystemContext(store)).toBe('');
  });

  it('wraps entries with # Injected Context header', () => {
    const store = new ContextStore();
    store.add({ label: 'Style', content: 'Use tabs', source: 'user' });

    const result = buildSystemContext(store);
    expect(result).toContain('# Injected Context');
    expect(result).toContain('## Style');
    expect(result).toContain('Use tabs');
  });

  it('includes all entries separated by ---', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'first', source: 'user' });
    store.add({ label: 'B', content: 'second', source: 'tool' });

    const result = buildSystemContext(store);
    expect(result).toContain('## A');
    expect(result).toContain('first');
    expect(result).toContain('## B');
    expect(result).toContain('second');
    expect(result).toContain('---');
  });
});
