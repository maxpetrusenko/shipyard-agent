/**
 * Coordinate node helpers + worker orchestrator entrypoint.
 */

import type { PlanStep, ShipyardStateType } from '../state.js';
import type { SubTask } from '../../multi-agent/supervisor.js';
import type { WorkerResult } from '../../multi-agent/worker.js';
import { deriveScopeConstraints } from '../guards.js';
import { basename, isAbsolute, relative } from 'node:path';
import { runCoordinatedWorkerPlan } from './coordinate-worker-plan.js';

/** Extract file paths mentioned in a subtask description. */
export function extractSubtaskFiles(description: string): string[] {
  const seen = new Set<string>();
  const regex = /(?:^|\s)(\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8})(?=$|\s|[.,;:()])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(description)) !== null) {
    const raw = match[1]?.trim();
    if (raw) seen.add(raw);
  }
  return [...seen];
}

function topLevelRootFor(workDir: string, filePath: string): string {
  const normalizedFilePath = filePath.trim();
  if (!normalizedFilePath) return '';

  let rel = normalizedFilePath;
  if (workDir) {
    rel = relative(workDir, normalizedFilePath);
  } else if (isAbsolute(normalizedFilePath)) {
    const cwdRelative = relative(process.cwd(), normalizedFilePath);
    rel = cwdRelative && !cwdRelative.startsWith('..') ? cwdRelative : normalizedFilePath.replace(/^\/+/, '');
  }

  const root = rel
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .find((segment) => segment !== '..');
  return root ?? basename(rel);
}

export function markCompletedStepsFromWorkers(
  steps: PlanStep[],
  subtasks: SubTask[],
  results: WorkerResult[],
): PlanStep[] {
  const subtaskById = new Map(subtasks.map((task) => [task.id, task]));
  const workerCoveredFiles = new Set<string>();

  for (const result of results) {
    if (result.phase !== 'done') continue;

    for (const edit of result.fileEdits) {
      workerCoveredFiles.add(edit.file_path);
    }

    const task = subtaskById.get(result.subtaskId);
    const declaredFiles =
      task?.files && task.files.length > 0
        ? task.files
        : extractSubtaskFiles(task?.description ?? '');
    for (const file of declaredFiles) {
      workerCoveredFiles.add(file);
    }
  }

  return steps.map((step) => {
    if (step.status === 'done') return step;
    if (step.files.length === 0) return { ...step, status: 'done' as const };
    const hasOverlap = step.files.some((file) => workerCoveredFiles.has(file));
    return { ...step, status: hasOverlap ? 'done' as const : step.status };
  });
}

/**
 * Legacy parallelism heuristic.
 * Kept for tests + future fan-out work, but runtime now defaults to worker orchestration.
 */
export function shouldCoordinate(state: ShipyardStateType): boolean {
  if (state.forceSequential) return false;
  if (state.steps.length < 3) return false;
  const plannedFiles = state.steps
    .flatMap((step) => step.files)
    .filter((filePath) => filePath.trim().length > 0);
  const uniquePlanned = new Set(plannedFiles);
  if (uniquePlanned.size < 3) return false;

  const constraints = deriveScopeConstraints(state.instruction);
  if (constraints.strictSingleFile || constraints.disallowUnrelatedFiles) {
    return false;
  }
  if (uniquePlanned.size !== plannedFiles.length) {
    return false;
  }

  const rootOwners = new Map<string, number>();
  const workDir = state.workDir ?? '';
  for (const step of state.steps) {
    const stepRoots = new Set(step.files.map((filePath) => topLevelRootFor(workDir, filePath)).filter(Boolean));
    if (stepRoots.size === 0) continue;
    for (const root of stepRoots) {
      const owners = (rootOwners.get(root) ?? 0) + 1;
      rootOwners.set(root, owners);
      if (owners > 1) return false;
    }
  }

  if (rootOwners.size < 2) {
    return false;
  }

  const allFiles = state.steps.map((step) => new Set(step.files));
  for (let i = 0; i < allFiles.length; i += 1) {
    for (let j = i + 1; j < allFiles.length; j += 1) {
      const setI = allFiles[i];
      const setJ = allFiles[j];
      if (!setI || !setJ) continue;
      if (setI.size === 0 || setJ.size === 0) continue;
      const overlap = [...setI].some((file) => setJ.has(file));
      if (!overlap) return true;
    }
  }
  return false;
}

export async function coordinateNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  return runCoordinatedWorkerPlan(state);
}
