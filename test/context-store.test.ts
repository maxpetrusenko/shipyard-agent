import { describe, it, expect } from 'vitest';
import { ContextStore } from '../src/context/store.js';
import { buildSystemContext } from '../src/context/injector.js';

describe('ContextStore', () => {
  it('adds and retrieves entries', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'alpha', source: 'user' });
    store.add({ label: 'B', content: 'beta', source: 'system' });

    expect(store.getAll()).toHaveLength(2);
    expect(store.get('A')?.content).toBe('alpha');
    expect(store.get('B')?.source).toBe('system');
  });

  it('overwrites entry with same label', () => {
    const store = new ContextStore();
    store.add({ label: 'X', content: 'v1', source: 'user' });
    store.add({ label: 'X', content: 'v2', source: 'tool' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.get('X')?.content).toBe('v2');
  });

  it('removes entry by label', () => {
    const store = new ContextStore();
    store.add({ label: 'R', content: 'remove me', source: 'user' });

    expect(store.remove('R')).toBe(true);
    expect(store.get('R')).toBeUndefined();
    expect(store.remove('R')).toBe(false);
  });

  it('clears all entries', () => {
    const store = new ContextStore();
    store.add({ label: 'A', content: 'a', source: 'user' });
    store.add({ label: 'B', content: 'b', source: 'user' });
    store.clear();

    expect(store.getAll()).toHaveLength(0);
  });

  it('generates markdown representation', () => {
    const store = new ContextStore();
    store.add({ label: 'Guide', content: 'Do the thing', source: 'system' });

    const md = store.toMarkdown();
    expect(md).toContain('## Guide');
    expect(md).toContain('Do the thing');
  });
});

describe('buildSystemContext', () => {
  it('returns empty string when store is empty', () => {
    const store = new ContextStore();
    expect(buildSystemContext(store)).toBe('');
  });

  it('builds markdown sections from store entries', () => {
    const store = new ContextStore();
    store.add({ label: 'Rules', content: 'Be nice', source: 'user' });
    store.add({ label: 'Config', content: 'port=4200', source: 'system' });

    const result = buildSystemContext(store);
    expect(result).toContain('# Injected Context');
    expect(result).toContain('## Rules');
    expect(result).toContain('Be nice');
    expect(result).toContain('## Config');
    expect(result).toContain('port=4200');
  });
});
