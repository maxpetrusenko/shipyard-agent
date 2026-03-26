import { beforeEach, describe, expect, it, vi } from 'vitest';

const revertChangesMock = vi.fn();
const loadRunsFromFilesMock = vi.fn();
const loadRunFromFileMock = vi.fn();
const createWorkspaceCheckpointMock = vi.fn();
const listWorkspaceCheckpointsMock = vi.fn();
const rollbackWorkspaceCheckpointMock = vi.fn();
const hasSuccessfulPrToolCallMock = vi.fn();

vi.mock('../../src/tools/index.js', () => ({
  TOOL_SCHEMAS: [
    { name: 'read_file' },
    { name: 'edit_file' },
    { name: 'revert_changes' },
  ],
}));

vi.mock('../../src/tools/revert-changes.js', () => ({
  revertChanges: (...args: unknown[]) => revertChangesMock(...args),
}));

vi.mock('../../src/runtime/persistence.js', () => ({
  loadRunsFromFiles: (...args: unknown[]) => loadRunsFromFilesMock(...args),
  loadRunFromFile: (...args: unknown[]) => loadRunFromFileMock(...args),
}));

vi.mock('../../src/runtime/checkpoints.js', () => ({
  createWorkspaceCheckpoint: (...args: unknown[]) => createWorkspaceCheckpointMock(...args),
  listWorkspaceCheckpoints: (...args: unknown[]) => listWorkspaceCheckpointsMock(...args),
  rollbackWorkspaceCheckpoint: (...args: unknown[]) => rollbackWorkspaceCheckpointMock(...args),
}));

vi.mock('../../src/tools/commit-and-open-pr.js', () => ({
  hasSuccessfulPrToolCall: (...args: unknown[]) => hasSuccessfulPrToolCallMock(...args),
}));

import {
  setCommandRuntimeControls,
  tryCommandShortcut,
} from '../../src/graph/commands.js';

describe('tryCommandShortcut', () => {
  beforeEach(() => {
    revertChangesMock.mockReset();
    loadRunsFromFilesMock.mockReset();
    loadRunFromFileMock.mockReset();
    createWorkspaceCheckpointMock.mockReset();
    listWorkspaceCheckpointsMock.mockReset();
    rollbackWorkspaceCheckpointMock.mockReset();
    hasSuccessfulPrToolCallMock.mockReset();
    loadRunsFromFilesMock.mockReturnValue([]);
    loadRunFromFileMock.mockReturnValue(null);
    setCommandRuntimeControls(null);
  });

  it('returns command and tool list for /tools', async () => {
    const out = await tryCommandShortcut('/tools');
    expect(out).toContain('Invokable commands:');
    expect(out).toContain('/undo');
    expect(out).toContain('read_file');
    expect(out).toContain('revert_changes');
  });

  it('supports /runs listing', async () => {
    loadRunsFromFilesMock.mockReturnValue([
      {
        runId: 'run-new',
        phase: 'done',
        fileEdits: [{ file_path: '/tmp/a.ts' }],
        savedAt: '2026-03-25T20:00:00.000Z',
      },
      {
        runId: 'run-old',
        phase: 'done',
        fileEdits: [],
        savedAt: '2026-03-25T19:00:00.000Z',
      },
    ]);
    const out = await tryCommandShortcut('/runs');
    expect(out).toContain('Recent runs:');
    expect(out).toContain('run-new');
    expect(out).toContain('edits=1');
  });

  it('supports status and cancel via runtime controls', async () => {
    const cancel = vi.fn(() => true);
    setCommandRuntimeControls({
      getStatus: () => ({
        processing: true,
        currentRunId: 'run-live',
        queueLength: 2,
        pauseRequested: false,
      }),
      cancel,
      resume: () => null,
    });

    const status = await tryCommandShortcut('/status');
    const cancelled = await tryCommandShortcut('/cancel');

    expect(status).toContain('Runtime status:');
    expect(status).toContain('currentRunId=run-live');
    expect(cancelled).toContain('Cancel requested');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('supports checkpoint and rollback commands', async () => {
    createWorkspaceCheckpointMock.mockReturnValue({
      success: true,
      checkpoint_id: 'cp_1',
      run_id: 'run-1',
      file_count: 2,
      message: 'ok',
    });
    rollbackWorkspaceCheckpointMock.mockReturnValue({
      success: true,
      checkpoint_id: 'cp_1',
      targeted_files: ['/tmp/a.ts'],
      restored_count: 1,
      removed_count: 0,
      failed_count: 0,
      message: 'done',
    });
    listWorkspaceCheckpointsMock.mockReturnValue([
      {
        checkpoint_id: 'cp_1',
        created_at: '2026-03-25T20:00:00.000Z',
        run_id: 'run-1',
        label: null,
        file_count: 2,
      },
    ]);

    const created = await tryCommandShortcut('/checkpoint --run run-1');
    const listed = await tryCommandShortcut('/checkpoints');
    const rolled = await tryCommandShortcut('/rollback --checkpoint cp_1');

    expect(created).toContain('Checkpoint created.');
    expect(listed).toContain('Workspace checkpoints:');
    expect(rolled).toContain('Rollback completed.');
  });

  it('routes natural "revert the change" to revert_changes tool', async () => {
    revertChangesMock.mockResolvedValue({
      success: true,
      outcome: 'success',
      execution_scope: 'local_only',
      run_id: 'run-1',
      strategy: 'trace_edits',
      targeted_files: ['/tmp/a.ts'],
      reverted_count: 1,
      failed_count: 0,
      action_receipts: [
        {
          action: 'trace_inverse_apply',
          outcome: 'completed',
          scope: 'local_only',
          details: 'reverted=1, failures=0; no git commit or push',
        },
      ],
      message: 'ok',
    });

    const out = await tryCommandShortcut('revert the change');

    expect(revertChangesMock).toHaveBeenCalledWith({
      scope: 'last_run',
      strategy: 'trace_edits',
    });
    expect(out).toContain('Revert completed.');
    expect(out).toContain('Scope: local_only');
    expect(out).toContain('Actions:');
    expect(out).toContain('Run: run-1');
  });

  it('supports safety summary', async () => {
    hasSuccessfulPrToolCallMock.mockReturnValue(false);
    loadRunFromFileMock.mockReturnValue({
      runId: 'run-safe',
      phase: 'done',
      error: null,
      fileEdits: [{ file_path: '/tmp/a.ts' }],
      verificationResult: { passed: true, summary: 'ok' },
      toolCallHistory: [],
    });

    const out = await tryCommandShortcut('/safety --run run-safe');
    expect(out).toContain('Safety summary for run run-safe:');
    expect(out).toContain('pr_opened=no');
  });
});
