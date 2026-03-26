/**
 * Revert agent edits from persisted run traces.
 *
 * Primary mode uses trace-level edit records (old_string/new_string) and applies
 * inverse edits in reverse order (latest first). Optional git-restore mode can
 * reset touched files from the working tree.
 */

import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { editFile } from './edit-file.js';
import { loadRunFromFile, loadRunsFromFiles } from '../runtime/persistence.js';
import type { RunResult } from '../runtime/loop.js';

const execFile = promisify(execFileCb);

export interface RevertChangesParams {
  /** last_run (default target) or run_id (explicit). */
  scope: 'last_run' | 'run_id';
  /** Required when scope=run_id. */
  run_id?: string;
  /** trace_edits (default) or git_restore. */
  strategy?: 'trace_edits' | 'git_restore';
  /** Optional file filter (absolute paths preferred). */
  file_paths?: string[];
  /** Preview only; do not modify files. */
  dry_run?: boolean;
}

export interface RevertChangesResult {
  success: boolean;
  outcome: 'success' | 'partial' | 'failed';
  execution_scope: 'local_only';
  run_id: string | null;
  strategy: 'trace_edits' | 'git_restore';
  targeted_files: string[];
  reverted_count: number;
  failed_count: number;
  failures: Array<{ file_path: string; error: string }>;
  action_receipts: Array<{
    action: string;
    outcome: 'completed' | 'partial' | 'failed' | 'skipped';
    scope: 'local_only';
    details: string;
  }>;
  message: string;
}

function outcomeFromCounts(
  revertedCount: number,
  failedCount: number,
): 'success' | 'partial' | 'failed' {
  if (failedCount === 0) return 'success';
  if (revertedCount > 0) return 'partial';
  return 'failed';
}

function sortRunsNewestFirst(runs: RunResult[]): RunResult[] {
  const ts = (r: RunResult): number => {
    const saved = r.savedAt ? Date.parse(r.savedAt) : NaN;
    if (Number.isFinite(saved)) return saved;
    const started = r.startedAt ? Date.parse(r.startedAt) : NaN;
    if (Number.isFinite(started)) return started;
    const queued = r.queuedAt ? Date.parse(r.queuedAt) : NaN;
    if (Number.isFinite(queued)) return queued;
    return 0;
  };
  return [...runs].sort((a, b) => ts(b) - ts(a));
}

function pickRun(params: RevertChangesParams): RunResult | null {
  if (params.scope === 'run_id') {
    if (!params.run_id?.trim()) return null;
    return loadRunFromFile(params.run_id.trim());
  }

  const runs = sortRunsNewestFirst(loadRunsFromFiles());
  return runs.find((r) => r.fileEdits.length > 0) ?? null;
}

function toPathFilterSet(filePaths: string[] | undefined): Set<string> | null {
  if (!filePaths || filePaths.length === 0) return null;
  return new Set(filePaths);
}

async function gitRootForPath(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', [
      '-C',
      dirname(filePath),
      'rev-parse',
      '--show-toplevel',
    ]);
    const root = stdout.trim();
    return root.length > 0 ? root : null;
  } catch {
    return null;
  }
}

async function gitRestoreFiles(
  filePaths: string[],
): Promise<{ restored: string[]; failures: Array<{ file_path: string; error: string }> }> {
  const byRepo = new Map<string, string[]>();
  const failures: Array<{ file_path: string; error: string }> = [];

  for (const fp of filePaths) {
    const root = await gitRootForPath(fp);
    if (!root) {
      failures.push({ file_path: fp, error: 'No git repository found for file path' });
      continue;
    }
    const rel = fp.startsWith(root + '/') ? fp.slice(root.length + 1) : fp;
    const arr = byRepo.get(root) ?? [];
    arr.push(rel);
    byRepo.set(root, arr);
  }

  const restored: string[] = [];
  for (const [repo, relPaths] of byRepo) {
    try {
      await execFile('git', ['-C', repo, 'restore', '--', ...relPaths]);
      restored.push(...relPaths.map((p) => `${repo}/${p}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const p of relPaths) {
        failures.push({ file_path: `${repo}/${p}`, error: msg });
      }
    }
  }

  return { restored, failures };
}

export async function revertChanges(
  params: RevertChangesParams,
): Promise<RevertChangesResult> {
  const strategy = params.strategy ?? 'trace_edits';
  const targetRun = pickRun(params);

  if (!targetRun) {
    return {
      success: false,
      outcome: 'failed',
      execution_scope: 'local_only',
      run_id: params.run_id ?? null,
      strategy,
      targeted_files: [],
      reverted_count: 0,
      failed_count: 1,
      failures: [{ file_path: '', error: 'Target run not found' }],
      action_receipts: [
        {
          action: 'select_target_run',
          outcome: 'failed',
          scope: 'local_only',
          details:
            params.scope === 'run_id'
              ? `run_id=${params.run_id ?? '(missing)'}, persisted result not found`
              : 'no previous run with file edits found in persisted results',
        },
      ],
      message:
        params.scope === 'run_id'
          ? `Run ${params.run_id ?? '(missing)'} not found in persisted results.`
          : 'No previous run with file edits found in persisted results.',
    };
  }

  const filterSet = toPathFilterSet(params.file_paths);
  const sourceEdits = targetRun.fileEdits.filter((e) =>
    filterSet ? filterSet.has(e.file_path) : true,
  );

  if (sourceEdits.length === 0) {
    return {
      success: false,
      outcome: 'failed',
      execution_scope: 'local_only',
      run_id: targetRun.runId,
      strategy,
      targeted_files: [],
      reverted_count: 0,
      failed_count: 1,
      failures: [{ file_path: '', error: 'No matching edits found' }],
      action_receipts: [
        {
          action: 'filter_target_edits',
          outcome: 'failed',
          scope: 'local_only',
          details: 'no edits matched requested file filter',
        },
      ],
      message: 'No matching edits were found for this run and file filter.',
    };
  }

  const targetedFiles = [...new Set(sourceEdits.map((e) => e.file_path))];

  if (params.dry_run) {
    return {
      success: true,
      outcome: 'success',
      execution_scope: 'local_only',
      run_id: targetRun.runId,
      strategy,
      targeted_files: targetedFiles,
      reverted_count: 0,
      failed_count: 0,
      failures: [],
      action_receipts: [
        {
          action: 'dry_run_preview',
          outcome: 'completed',
          scope: 'local_only',
          details: `would revert ${sourceEdits.length} edit operations across ${targetedFiles.length} files`,
        },
      ],
      message: `Dry run: would revert ${sourceEdits.length} edits across ${targetedFiles.length} files.`,
    };
  }

  if (strategy === 'git_restore') {
    const { restored, failures } = await gitRestoreFiles(targetedFiles);
    const outcome = outcomeFromCounts(restored.length, failures.length);
    return {
      success: failures.length === 0,
      outcome,
      execution_scope: 'local_only',
      run_id: targetRun.runId,
      strategy,
      targeted_files: targetedFiles,
      reverted_count: restored.length,
      failed_count: failures.length,
      failures,
      action_receipts: [
        {
          action: 'git_restore_files',
          outcome:
            outcome === 'success'
              ? 'completed'
              : outcome === 'partial'
                ? 'partial'
                : 'failed',
          scope: 'local_only',
          details: `restored=${restored.length}, failures=${failures.length}; local workspace only`,
        },
      ],
      message:
        failures.length === 0
          ? `Restored ${restored.length} files from git working tree state.`
          : `Restored ${restored.length} files with ${failures.length} failures.`,
    };
  }

  // Trace-based inverse application (reverse order preserves nested edits).
  const failures: Array<{ file_path: string; error: string }> = [];
  let reverted = 0;

  for (const edit of [...sourceEdits].reverse()) {
    try {
      const result = await editFile({
        file_path: edit.file_path,
        old_string: edit.new_string,
        new_string: edit.old_string,
      });
      if (result.success) {
        reverted += 1;
      } else {
        failures.push({ file_path: edit.file_path, error: result.message });
      }
    } catch (err) {
      failures.push({
        file_path: edit.file_path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const outcome = outcomeFromCounts(reverted, failures.length);
  return {
    success: failures.length === 0,
    outcome,
    execution_scope: 'local_only',
    run_id: targetRun.runId,
    strategy,
    targeted_files: targetedFiles,
    reverted_count: reverted,
    failed_count: failures.length,
    failures,
    action_receipts: [
      {
        action: 'trace_inverse_apply',
        outcome:
          outcome === 'success'
            ? 'completed'
            : outcome === 'partial'
              ? 'partial'
              : 'failed',
        scope: 'local_only',
        details: `reverted=${reverted}, failures=${failures.length}; no git commit or push`,
      },
    ],
    message:
      failures.length === 0
        ? `Reverted ${reverted} edit operations from run ${targetRun.runId}.`
        : `Reverted ${reverted} edit operations with ${failures.length} failures.`,
  };
}
