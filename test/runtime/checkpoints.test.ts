import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadRunFromFileMock = vi.fn();
const loadRunsFromFilesMock = vi.fn();

vi.mock('../../src/runtime/persistence.js', () => ({
  loadRunFromFile: (...args: unknown[]) => loadRunFromFileMock(...args),
  loadRunsFromFiles: (...args: unknown[]) => loadRunsFromFilesMock(...args),
}));

import {
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  rollbackWorkspaceCheckpoint,
} from '../../src/runtime/checkpoints.js';

describe('workspace checkpoints', () => {
  let root = '';

  beforeEach(() => {
    loadRunFromFileMock.mockReset();
    loadRunsFromFilesMock.mockReset();
    root = mkdtempSync(join(tmpdir(), 'shipyard-cp-'));
    process.env['SHIPYARD_CHECKPOINTS_DIR'] = join(root, 'checkpoints');
  });

  afterEach(() => {
    delete process.env['SHIPYARD_CHECKPOINTS_DIR'];
    rmSync(root, { recursive: true, force: true });
  });

  it('creates and lists checkpoints from run edits', () => {
    const fp = join(root, 'a.ts');
    writeFileSync(fp, 'before\n');
    loadRunFromFileMock.mockReturnValue({
      runId: 'r1',
      fileEdits: [{ file_path: fp }],
    });

    const created = createWorkspaceCheckpoint({ run_id: 'r1' });
    expect(created.success).toBe(true);
    expect(created.checkpoint_id).toBeTruthy();
    expect(created.file_count).toBe(1);

    const listed = listWorkspaceCheckpoints(5);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.run_id).toBe('r1');
  });

  it('rolls back file bytes from checkpoint', () => {
    const fp = join(root, 'b.ts');
    writeFileSync(fp, 'v1\n');
    loadRunFromFileMock.mockReturnValue({
      runId: 'r2',
      fileEdits: [{ file_path: fp }],
    });

    const created = createWorkspaceCheckpoint({ run_id: 'r2' });
    writeFileSync(fp, 'v2\n');

    const rolled = rollbackWorkspaceCheckpoint({
      checkpoint_id: created.checkpoint_id!,
    });
    expect(rolled.success).toBe(true);
    expect(rolled.restored_count).toBe(1);
    expect(readFileSync(fp, 'utf-8')).toBe('v1\n');
  });
});
