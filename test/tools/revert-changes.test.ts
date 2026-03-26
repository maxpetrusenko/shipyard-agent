import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../../src/runtime/loop.js';

const editFileMock = vi.fn();
const loadRunsFromFilesMock = vi.fn();
const loadRunFromFileMock = vi.fn();

vi.mock('../../src/tools/edit-file.js', () => ({
  editFile: (...args: unknown[]) => editFileMock(...args),
}));

vi.mock('../../src/runtime/persistence.js', () => ({
  loadRunsFromFiles: (...args: unknown[]) => loadRunsFromFilesMock(...args),
  loadRunFromFile: (...args: unknown[]) => loadRunFromFileMock(...args),
}));

import { revertChanges } from '../../src/tools/revert-changes.js';

function mkRun(
  runId: string,
  savedAt: string,
  edits: RunResult['fileEdits'],
): RunResult {
  return {
    runId,
    phase: 'done',
    steps: [],
    fileEdits: edits,
    toolCallHistory: [],
    tokenUsage: null,
    traceUrl: null,
    messages: [{ role: 'user', content: 'x' }],
    error: null,
    verificationResult: null,
    reviewFeedback: null,
    durationMs: 1,
    savedAt,
    nextActions: [],
  };
}

describe('revertChanges', () => {
  beforeEach(() => {
    editFileMock.mockReset();
    loadRunsFromFilesMock.mockReset();
    loadRunFromFileMock.mockReset();
  });

  it('reverts latest run edits in reverse order', async () => {
    const run = mkRun('r2', '2026-03-25T21:00:00.000Z', [
      {
        file_path: '/tmp/a.ts',
        tier: 1,
        old_string: 'A1',
        new_string: 'A2',
        timestamp: 1,
      },
      {
        file_path: '/tmp/b.ts',
        tier: 1,
        old_string: 'B1',
        new_string: 'B2',
        timestamp: 2,
      },
    ]);
    loadRunsFromFilesMock.mockReturnValue([
      mkRun('r1', '2026-03-25T20:00:00.000Z', []),
      run,
    ]);
    editFileMock.mockResolvedValue({ success: true, tier: 1, message: 'ok' });

    const res = await revertChanges({ scope: 'last_run', strategy: 'trace_edits' });

    expect(res.success).toBe(true);
    expect(res.run_id).toBe('r2');
    expect(res.reverted_count).toBe(2);
    expect(editFileMock).toHaveBeenCalledTimes(2);
    expect(editFileMock).toHaveBeenNthCalledWith(1, {
      file_path: '/tmp/b.ts',
      old_string: 'B2',
      new_string: 'B1',
    });
    expect(editFileMock).toHaveBeenNthCalledWith(2, {
      file_path: '/tmp/a.ts',
      old_string: 'A2',
      new_string: 'A1',
    });
  });

  it('supports dry-run without applying edits', async () => {
    loadRunsFromFilesMock.mockReturnValue([
      mkRun('r3', '2026-03-25T21:00:00.000Z', [
        {
          file_path: '/tmp/a.ts',
          tier: 1,
          old_string: 'x',
          new_string: 'y',
          timestamp: 1,
        },
      ]),
    ]);

    const res = await revertChanges({ scope: 'last_run', dry_run: true });

    expect(res.success).toBe(true);
    expect(res.reverted_count).toBe(0);
    expect(res.targeted_files).toEqual(['/tmp/a.ts']);
    expect(editFileMock).not.toHaveBeenCalled();
  });

  it('returns error when explicit run_id is missing', async () => {
    loadRunFromFileMock.mockReturnValue(null);
    const res = await revertChanges({
      scope: 'run_id',
      run_id: 'missing',
      strategy: 'trace_edits',
    });
    expect(res.success).toBe(false);
    expect(res.run_id).toBe('missing');
  });

  it('reports partial outcome when some inverse edits fail', async () => {
    loadRunsFromFilesMock.mockReturnValue([
      mkRun('r4', '2026-03-25T21:00:00.000Z', [
        {
          file_path: '/tmp/a.ts',
          tier: 1,
          old_string: 'x',
          new_string: 'y',
          timestamp: 1,
        },
        {
          file_path: '/tmp/b.ts',
          tier: 1,
          old_string: 'm',
          new_string: 'n',
          timestamp: 2,
        },
      ]),
    ]);
    editFileMock
      .mockResolvedValueOnce({ success: true, tier: 1, message: 'ok' })
      .mockResolvedValueOnce({ success: false, tier: 1, message: 'missing match' });

    const res = await revertChanges({ scope: 'last_run', strategy: 'trace_edits' });

    expect(res.success).toBe(false);
    expect(res.outcome).toBe('partial');
    expect(res.execution_scope).toBe('local_only');
    expect(res.reverted_count).toBe(1);
    expect(res.failed_count).toBe(1);
    expect(res.action_receipts[0]?.action).toBe('trace_inverse_apply');
    expect(res.action_receipts[0]?.outcome).toBe('partial');
  });
});
