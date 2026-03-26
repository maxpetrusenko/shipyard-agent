/**
 * Lightweight workspace checkpoints for dynamic rollback.
 *
 * A checkpoint captures current file contents for files touched by a run (or
 * an explicit file list). Rollback restores those file bytes exactly.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunFromFile, loadRunsFromFiles } from './persistence.js';
import type { RunResult } from './loop.js';

interface FileSnapshot {
  file_path: string;
  existed: boolean;
  content_b64: string | null;
}

interface WorkspaceCheckpoint {
  checkpoint_id: string;
  label: string | null;
  created_at: string;
  run_id: string | null;
  file_count: number;
  files: FileSnapshot[];
}

export interface CreateCheckpointParams {
  run_id?: string;
  label?: string;
  file_paths?: string[];
}

export interface CreateCheckpointResult {
  success: boolean;
  checkpoint_id: string | null;
  run_id: string | null;
  file_count: number;
  message: string;
}

export interface RollbackCheckpointParams {
  checkpoint_id: string;
  file_paths?: string[];
  dry_run?: boolean;
}

export interface RollbackCheckpointResult {
  success: boolean;
  checkpoint_id: string;
  targeted_files: string[];
  restored_count: number;
  removed_count: number;
  failed_count: number;
  message: string;
}

export interface CheckpointSummary {
  checkpoint_id: string;
  created_at: string;
  run_id: string | null;
  label: string | null;
  file_count: number;
}

function checkpointsDir(): string {
  const fromEnv = process.env['SHIPYARD_CHECKPOINTS_DIR']?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'results', 'checkpoints');
}

function ensureCheckpointsDir(dir = checkpointsDir()): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function checkpointFilePath(checkpointId: string): string {
  return join(checkpointsDir(), `${checkpointId}.json`);
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

function chooseRun(runId?: string): RunResult | null {
  if (runId?.trim()) return loadRunFromFile(runId.trim());
  const runs = sortRunsNewestFirst(loadRunsFromFiles());
  return runs.find((r) => (r.fileEdits?.length ?? 0) > 0) ?? null;
}

function pickFilePaths(run: RunResult, explicit?: string[]): string[] {
  const touched = [...new Set((run.fileEdits ?? []).map((e) => e.file_path))];
  if (!explicit || explicit.length === 0) return touched;
  const allow = new Set(explicit);
  return touched.filter((p) => allow.has(p));
}

function makeCheckpointId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cp_${Date.now().toString(36)}_${rand}`;
}

function readCheckpoint(checkpointId: string): WorkspaceCheckpoint | null {
  try {
    const raw = readFileSync(checkpointFilePath(checkpointId), 'utf-8');
    const parsed = JSON.parse(raw) as WorkspaceCheckpoint;
    if (!parsed || parsed.checkpoint_id !== checkpointId || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createWorkspaceCheckpoint(
  params: CreateCheckpointParams = {},
): CreateCheckpointResult {
  ensureCheckpointsDir();
  const run = chooseRun(params.run_id);
  if (!run) {
    return {
      success: false,
      checkpoint_id: null,
      run_id: params.run_id ?? null,
      file_count: 0,
      message: params.run_id
        ? `Run ${params.run_id} not found.`
        : 'No persisted run with edits found.',
    };
  }

  const filePaths = pickFilePaths(run, params.file_paths);
  if (filePaths.length === 0) {
    return {
      success: false,
      checkpoint_id: null,
      run_id: run.runId,
      file_count: 0,
      message: 'No matching files found for checkpoint.',
    };
  }

  const files: FileSnapshot[] = filePaths.map((fp) => {
    if (!existsSync(fp)) {
      return {
        file_path: fp,
        existed: false,
        content_b64: null,
      };
    }
    const buf = readFileSync(fp);
    return {
      file_path: fp,
      existed: true,
      content_b64: buf.toString('base64'),
    };
  });

  const checkpointId = makeCheckpointId();
  const payload: WorkspaceCheckpoint = {
    checkpoint_id: checkpointId,
    label: params.label?.trim() || null,
    created_at: new Date().toISOString(),
    run_id: run.runId,
    file_count: files.length,
    files,
  };
  writeFileSync(checkpointFilePath(checkpointId), `${JSON.stringify(payload, null, 2)}\n`);
  return {
    success: true,
    checkpoint_id: checkpointId,
    run_id: run.runId,
    file_count: files.length,
    message: `Checkpoint ${checkpointId} captured ${files.length} files.`,
  };
}

export function rollbackWorkspaceCheckpoint(
  params: RollbackCheckpointParams,
): RollbackCheckpointResult {
  const cp = readCheckpoint(params.checkpoint_id);
  if (!cp) {
    return {
      success: false,
      checkpoint_id: params.checkpoint_id,
      targeted_files: [],
      restored_count: 0,
      removed_count: 0,
      failed_count: 1,
      message: `Checkpoint ${params.checkpoint_id} not found.`,
    };
  }

  const filter = params.file_paths?.length ? new Set(params.file_paths) : null;
  const targets = cp.files.filter((f) => (filter ? filter.has(f.file_path) : true));
  if (targets.length === 0) {
    return {
      success: false,
      checkpoint_id: cp.checkpoint_id,
      targeted_files: [],
      restored_count: 0,
      removed_count: 0,
      failed_count: 1,
      message: 'No files matched rollback filter.',
    };
  }

  if (params.dry_run) {
    return {
      success: true,
      checkpoint_id: cp.checkpoint_id,
      targeted_files: targets.map((t) => t.file_path),
      restored_count: 0,
      removed_count: 0,
      failed_count: 0,
      message: `Dry run: would rollback ${targets.length} files from ${cp.checkpoint_id}.`,
    };
  }

  let restored = 0;
  let removed = 0;
  let failed = 0;
  for (const file of targets) {
    try {
      if (file.existed) {
        const buf = Buffer.from(file.content_b64 ?? '', 'base64');
        writeFileSync(file.file_path, buf);
        restored += 1;
      } else if (existsSync(file.file_path)) {
        unlinkSync(file.file_path);
        removed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    success: failed === 0,
    checkpoint_id: cp.checkpoint_id,
    targeted_files: targets.map((t) => t.file_path),
    restored_count: restored,
    removed_count: removed,
    failed_count: failed,
    message:
      failed === 0
        ? `Rollback from ${cp.checkpoint_id} completed (${restored} restored, ${removed} removed).`
        : `Rollback from ${cp.checkpoint_id} finished with ${failed} failure(s).`,
  };
}

export function listWorkspaceCheckpoints(limit = 20): CheckpointSummary[] {
  const dir = ensureCheckpointsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: CheckpointSummary[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const cp = JSON.parse(raw) as WorkspaceCheckpoint;
      if (!cp?.checkpoint_id) continue;
      out.push({
        checkpoint_id: cp.checkpoint_id,
        created_at: cp.created_at,
        run_id: cp.run_id,
        label: cp.label,
        file_count: cp.file_count,
      });
    } catch {
      // Skip malformed checkpoints
    }
  }
  return out
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.max(1, limit));
}

