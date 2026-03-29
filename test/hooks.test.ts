import { describe, it, expect, vi } from 'vitest';
import {
  runBeforeHooks,
  runAfterHooks,
  createRecordingHooks,
  createPlanLiveHooks,
  createLoggingHooks,
  mergeHooks,
  setLiveFeedListener,
} from '../src/tools/hooks.js';
import type { FileEdit, ToolCallRecord } from '../src/graph/state.js';

// ---------------------------------------------------------------------------
// runBeforeHooks / runAfterHooks
// ---------------------------------------------------------------------------

describe('runBeforeHooks', () => {
  it('calls all before hooks in order', async () => {
    const order: number[] = [];
    const hooks = {
      onBeforeToolCall: [
        async () => { order.push(1); },
        async () => { order.push(2); },
      ],
    };

    await runBeforeHooks(hooks, { tool_name: 'read_file', tool_input: {} });
    expect(order).toEqual([1, 2]);
  });

  it('no-ops when onBeforeToolCall is undefined', async () => {
    // Should not throw
    await runBeforeHooks({}, { tool_name: 'read_file', tool_input: {} });
  });
});

describe('runAfterHooks', () => {
  it('calls all after hooks with result context', async () => {
    const captured: string[] = [];
    const hooks = {
      onAfterToolCall: [
        async (ctx: { tool_name: string; duration_ms: number }) => {
          captured.push(`${ctx.tool_name}:${ctx.duration_ms}`);
        },
      ],
    };

    await runAfterHooks(hooks, {
      tool_name: 'bash',
      tool_input: { command: 'ls' },
      tool_result: { success: true },
      duration_ms: 42,
    });

    expect(captured).toEqual(['bash:42']);
  });

  it('no-ops when onAfterToolCall is undefined', async () => {
    await runAfterHooks({}, {
      tool_name: 'bash',
      tool_input: {},
      tool_result: {},
      duration_ms: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// createRecordingHooks
// ---------------------------------------------------------------------------

describe('createRecordingHooks', () => {
  it('records edit_file calls to edits array', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    await runAfterHooks(hooks, {
      tool_name: 'edit_file',
      tool_input: {
        file_path: '/tmp/foo.ts',
        old_string: 'old',
        new_string: 'new',
      },
      tool_result: { success: true, tier: 1 },
      duration_ms: 10,
    });

    expect(edits).toHaveLength(1);
    expect(edits[0].file_path).toBe('/tmp/foo.ts');
    expect(edits[0].tier).toBe(1);
    expect(edits[0].old_string).toBe('old');
    expect(edits[0].new_string).toBe('new');
    expect(edits[0].timestamp).toBeGreaterThan(0);
  });

  it('records write_file success as tier-4 file edit', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    await runAfterHooks(hooks, {
      tool_name: 'write_file',
      tool_input: {
        file_path: '/tmp/new.ts',
        content: 'line1\nline2',
      },
      tool_result: { success: true, message: 'ok' },
      duration_ms: 8,
    });

    expect(edits).toHaveLength(1);
    expect(edits[0].file_path).toBe('/tmp/new.ts');
    expect(edits[0].tier).toBe(4);
    expect(edits[0].old_string).toBe('');
    expect(edits[0].new_string).toBe('line1\nline2');
  });

  it('does not record edit_file on failure', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    await runAfterHooks(hooks, {
      tool_name: 'edit_file',
      tool_input: { file_path: '/tmp/x.ts', old_string: 'a', new_string: 'b' },
      tool_result: { success: false, message: 'not found' },
      duration_ms: 5,
    });

    expect(edits).toHaveLength(0);
    // But history still records it
    expect(history).toHaveLength(1);
  });

  it('records all tool calls to history', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    await runAfterHooks(hooks, {
      tool_name: 'bash',
      tool_input: { command: 'echo hello' },
      tool_result: { success: true, output: 'hello' },
      duration_ms: 100,
    });

    expect(history).toHaveLength(1);
    expect(history[0].tool_name).toBe('bash');
    expect(history[0].duration_ms).toBe(100);
    expect(history[0].tool_result).toContain('"success":true');
  });

  it('caps tool call history at 500 entries', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    for (let index = 0; index < 520; index += 1) {
      await runAfterHooks(hooks, {
        tool_name: 'bash',
        tool_input: { command: `echo ${index}` },
        tool_result: { success: true, output: String(index) },
        duration_ms: 1,
      });
    }

    expect(history).toHaveLength(500);
    expect(history[0].tool_result).toContain('20');
  });

  it('truncates large tool results in history', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);

    const bigResult = { success: true, output: 'x'.repeat(20_000) };

    await runAfterHooks(hooks, {
      tool_name: 'read_file',
      tool_input: { file_path: '/tmp/big.ts' },
      tool_result: bigResult,
      duration_ms: 50,
    });

    expect(history[0].tool_result.length).toBeLessThanOrEqual(10_000);
  });

  it('emits full live tool payload for rich timeline cards', async () => {
    const edits: FileEdit[] = [];
    const history: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(edits, history);
    const liveFeed = vi.fn();
    setLiveFeedListener(liveFeed);

    await runAfterHooks(hooks, {
      tool_name: 'bash',
      tool_input: { command: 'echo hello' },
      tool_result: { success: true, output: 'hello' },
      duration_ms: 100,
    });

    expect(liveFeed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool',
      tool_name: 'bash',
      tool_input: { command: 'echo hello' },
      tool_result: expect.stringContaining('"output":"hello"'),
      duration_ms: 100,
    }));
    setLiveFeedListener(null);
  });
});

describe('createPlanLiveHooks', () => {
  it('emits live plan tool payload for web search cards', async () => {
    const hooks = createPlanLiveHooks();
    const liveFeed = vi.fn();
    setLiveFeedListener(liveFeed);

    await runAfterHooks(hooks, {
      tool_name: 'websearch',
      tool_input: { query: 'latest bun release' },
      tool_result: { success: true, results: [{ title: 'Bun', url: 'https://bun.sh' }] },
      duration_ms: 42,
    });

    expect(liveFeed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool',
      tool_name: 'websearch',
      detail: 'latest bun release',
      tool_input: { query: 'latest bun release' },
      tool_result: expect.stringContaining('"results"'),
      duration_ms: 42,
    }));
    setLiveFeedListener(null);
  });

  it('fans out live feed events to multiple listeners without clobbering', async () => {
    const hooks = createPlanLiveHooks();
    const first = vi.fn();
    const second = vi.fn();
    const clearFirst = setLiveFeedListener(first);
    const clearSecond = setLiveFeedListener(second);

    await runAfterHooks(hooks, {
      tool_name: 'websearch',
      tool_input: { query: 'shipyard' },
      tool_result: { success: true, results: [] },
      duration_ms: 12,
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    clearFirst?.();
    clearSecond?.();
    setLiveFeedListener(null);
  });
});

// ---------------------------------------------------------------------------
// createLoggingHooks
// ---------------------------------------------------------------------------

describe('createLoggingHooks', () => {
  it('logs before and after tool calls', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hooks = createLoggingHooks();

    await runBeforeHooks(hooks, {
      tool_name: 'bash',
      tool_input: { command: 'pwd' },
    });
    await runAfterHooks(hooks, {
      tool_name: 'bash',
      tool_input: { command: 'pwd' },
      tool_result: { success: true },
      duration_ms: 15,
    });

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[0][0]).toContain('[tool] bash');
    expect(logSpy.mock.calls[1][0]).toContain('ok');
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// mergeHooks
// ---------------------------------------------------------------------------

describe('mergeHooks', () => {
  it('merges multiple hook sets', async () => {
    const order: string[] = [];
    const a = { onBeforeToolCall: [async () => { order.push('a'); }] };
    const b = { onBeforeToolCall: [async () => { order.push('b'); }] };
    const c = { onAfterToolCall: [async () => { order.push('c'); }] };

    const merged = mergeHooks(a, b, c);

    await runBeforeHooks(merged, { tool_name: 'ls', tool_input: {} });
    await runAfterHooks(merged, {
      tool_name: 'ls',
      tool_input: {},
      tool_result: {},
      duration_ms: 0,
    });

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('handles empty hook sets', () => {
    const merged = mergeHooks({}, {});
    expect(merged.onBeforeToolCall).toEqual([]);
    expect(merged.onAfterToolCall).toEqual([]);
  });
});
