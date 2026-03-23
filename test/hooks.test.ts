import { describe, it, expect, vi } from 'vitest';
import {
  runBeforeHooks,
  runAfterHooks,
  createRecordingHooks,
  createLoggingHooks,
  mergeHooks,
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
