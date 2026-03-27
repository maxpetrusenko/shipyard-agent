/**
 * Coordinate node: orchestrates multi-agent parallel execution.
 *
 * When the plan has multiple independent steps, this node:
 * 1. Uses the supervisor to decompose the instruction into subtasks
 * 2. Dispatches workers sequentially (parallel-safe but sequential for now)
 * 3. Merges results and detects file conflicts
 * 4. Feeds merged edits + tool history back into state for verify
 */

import { decomposeTask, type SubTask } from '../../multi-agent/supervisor.js';
import { runWorker, type WorkerResult } from '../../multi-agent/worker.js';
import { detectConflicts, mergeEdits } from '../../multi-agent/merge.js';
import { deriveScopeConstraints } from '../guards.js';
import { WORK_DIR } from '../../config/work-dir.js';
import type {
  ShipyardStateType,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
  PlanStep,
} from '../state.js';
import { relative } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract file paths mentioned in a subtask description. */
export function extractSubtaskFiles(description: string): string[] {
  const seen = new Set<string>();
  const regex = /(?:^|\s)(\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8})(?=$|\s|[.,;:()])/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(description)) !== null) {
    const raw = m[1]?.trim();
    if (raw) seen.add(raw);
  }
  return [...seen];
}

function topLevelRootFor(filePath: string): string {
  const rel = relative(WORK_DIR, filePath);
  return rel.split('/').filter(Boolean)[0] ?? '';
}

function collectSubtaskFiles(task: SubTask): string[] {
  const seen = new Set<string>();
  for (const file of task.files ?? []) {
    const trimmed = file.trim();
    if (trimmed) seen.add(trimmed);
  }
  for (const file of extractSubtaskFiles(task.description)) {
    seen.add(file);
  }
  return [...seen];
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

// ---------------------------------------------------------------------------
// shouldCoordinate — gate for multi-agent path
// ---------------------------------------------------------------------------

/**
 * Determine whether the plan benefits from multi-agent coordination.
 * Returns true if there are 2+ steps that don't share files.
 */
export function shouldCoordinate(state: ShipyardStateType): boolean {
  if (state.steps.length < 3) return false;
  const plannedFiles = state.steps
    .flatMap((s) => s.files)
    .filter((p) => p.trim().length > 0);
  const uniquePlanned = new Set(plannedFiles);
  if (uniquePlanned.size < 3) return false;

  const constraints = deriveScopeConstraints(state.instruction);
  if (constraints.strictSingleFile || constraints.disallowUnrelatedFiles) {
    return false;
  }

  // Only coordinate plans with globally disjoint file ownership. If any file
  // appears in multiple steps, workers can race on shared infrastructure and
  // merge conflicts become the common path.
  if (uniquePlanned.size !== plannedFiles.length) {
    return false;
  }

  // Long rebuild traces showed repeat merge conflicts when multiple plan steps
  // owned files inside the same top-level root. Require exclusive root
  // ownership per step before enabling coordination.
  const rootOwners = new Map<string, number>();
  for (const step of state.steps) {
    const stepRoots = new Set(step.files.map(topLevelRootFor).filter(Boolean));
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

  // Check for file independence between steps
  const allFiles = state.steps.map((s) => new Set(s.files));
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      const setI = allFiles[i];
      const setJ = allFiles[j];
      if (!setI || !setJ) continue;
      if (setI.size === 0 || setJ.size === 0) continue;

      const overlap = [...setI].some((f) => setJ.has(f));
      if (!overlap) {
        return true; // At least 2 steps with no file overlap
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// coordinateNode
// ---------------------------------------------------------------------------

export async function coordinateNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const newMessages: LLMMessage[] = [...state.messages];
  const startTokens = state.tokenUsage ?? { input: 0, output: 0 };

  // 1. Decompose instruction into subtasks via supervisor LLM
  let subtasks: SubTask[];
  let sequentialPairs: string[][];
  try {
    const decomposed = await decomposeTask(state.instruction, {
      modelOverride: state.modelOverride ?? null,
      modelFamily: state.modelFamily ?? null,
      modelOverrides: state.modelOverrides ?? null,
    });
    subtasks = decomposed.subtasks;
    sequentialPairs = decomposed.sequentialPairs;
  } catch (err) {
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Subtask decomposition failed (${err instanceof Error ? err.message : String(err)}). Falling through to execute.`,
    });
    return {
      phase: 'executing',
      messages: newMessages,
      workerResults: [],
    };
  }

  if (subtasks.length <= 1) {
    // Not worth parallelizing — fall through to normal execute
    newMessages.push({
      role: 'assistant',
      content: '[Coordinator] Single subtask detected, falling through to execute.',
    });
    return {
      phase: 'executing',
      messages: newMessages,
      workerResults: [],
    };
  }

  newMessages.push({
    role: 'assistant',
    content: `[Coordinator] Decomposed into ${subtasks.length} subtasks. Dispatching workers...`,
  });

  // 2. Build dependency graph from sequential pairs
  const blocked = new Set<string>();
  for (const pair of sequentialPairs) {
    const after = pair[1];
    if (after) blocked.add(after);
  }

  const independent = subtasks.filter((t) => !blocked.has(t.id));
  const sequential = subtasks.filter((t) => blocked.has(t.id));

  // 2b. File conflict prevention: detect overlapping file paths across subtasks
  // and serialize those instead of running in parallel.
  // Check both exact path overlaps AND directory-level overlaps for common
  // service directories that frequently cause merge conflicts.
  const fileOwnership = new Map<string, string[]>();
  const dirOwnership = new Map<string, string[]>();
  const rootOwnership = new Map<string, string[]>();
  for (const task of independent) {
    const taskFiles = collectSubtaskFiles(task);
    for (const file of taskFiles) {
      const owners = fileOwnership.get(file) ?? [];
      owners.push(task.id);
      fileOwnership.set(file, owners);
      // Track directory-level ownership for shared service dirs
      const relFile = relative(WORK_DIR, file);
      const dirParts = relFile.split('/').filter(Boolean);
      // Flag shared directories like api/src/services, src/services, etc.
      if (dirParts.length >= 2) {
        const serviceDir = dirParts.slice(0, Math.min(3, dirParts.length - 1)).join('/');
        const dirOwners = dirOwnership.get(serviceDir) ?? [];
        dirOwners.push(task.id);
        dirOwnership.set(serviceDir, dirOwners);
      }
      const root = topLevelRootFor(file);
      if (root) {
        const rootOwners = rootOwnership.get(root) ?? [];
        rootOwners.push(task.id);
        rootOwnership.set(root, rootOwners);
      }
    }
  }
  const conflictingTaskIds = new Set<string>();
  const conflictPaths: string[] = [];
  for (const [filePath, owners] of fileOwnership) {
    if (owners.length > 1) {
      for (const id of owners) conflictingTaskIds.add(id);
      conflictPaths.push(filePath);
    }
  }
  // Directory-level conflicts: if 2+ tasks touch files in the same service dir
  for (const [dir, owners] of dirOwnership) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length > 1) {
      for (const id of uniqueOwners) conflictingTaskIds.add(id);
      if (!conflictPaths.includes(dir)) conflictPaths.push(`${dir}/ (directory conflict)`);
    }
  }
  for (const [root, owners] of rootOwnership) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length > 1) {
      for (const id of uniqueOwners) conflictingTaskIds.add(id);
      if (!conflictPaths.includes(root)) conflictPaths.push(`${root}/ (root conflict)`);
    }
  }
  const safeParallel = independent.filter((t) => !conflictingTaskIds.has(t.id));
  const serialized = [
    ...independent.filter((t) => conflictingTaskIds.has(t.id)),
    ...sequential,
  ];
  if (conflictPaths.length > 0) {
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Serialized ${conflictingTaskIds.size} subtasks to avoid file conflicts on: ${conflictPaths.join(', ')}`,
    });
  }

  // 3. Dispatch safe-parallel workers (no file overlaps)
  const parallelResults = await Promise.all(
    safeParallel.map((task) =>
      runWorker(task.id, task.description, state.contexts, {
        modelOverride: state.modelOverride ?? null,
        modelFamily: state.modelFamily ?? null,
        modelOverrides: state.modelOverrides ?? null,
      }),
    ),
  );

  // 4. Dispatch serialized workers one at a time (overlap + dependency-blocked)
  const sequentialResults: WorkerResult[] = [];
  for (const task of serialized) {
    const result = await runWorker(task.id, task.description, state.contexts, {
      modelOverride: state.modelOverride ?? null,
      modelFamily: state.modelFamily ?? null,
      modelOverrides: state.modelOverrides ?? null,
    });
    sequentialResults.push(result);
  }

  const allResults = [...parallelResults, ...sequentialResults];

  // 5. Detect and resolve conflicts
  const conflicts = detectConflicts(allResults);
  const { merged, needsReplan } = mergeEdits(allResults, conflicts);

  // 6. Aggregate token usage
  let totalInput = startTokens.input;
  let totalOutput = startTokens.output;
  for (const r of allResults) {
    if (r.tokenUsage) {
      totalInput += r.tokenUsage.input;
      totalOutput += r.tokenUsage.output;
    }
  }

  // 7. Aggregate file edits
  const allEdits: FileEdit[] = [...state.fileEdits, ...merged];

  // 8. Aggregate tool call history
  const allHistory: ToolCallRecord[] = [...state.toolCallHistory];
  for (const r of allResults) {
    allHistory.push(...r.toolCallHistory);
  }

  // 9. Report status
  const errors = allResults.filter((r) => r.error);
  const hasConflicts = needsReplan.length > 0;
  const workerSummary = allResults.map((r) => ({
    subtaskId: r.subtaskId,
    phase: r.phase,
    editCount: r.fileEdits.length,
    toolCallCount: r.toolCallHistory.length,
    error: r.error,
    durationMs: r.durationMs,
  }));

  if (errors.length > 0) {
    // Worker errors are real issues — flag for retry
    const parts: string[] = [
      'Errors:\n' +
        errors.map((r) => `  Worker ${r.subtaskId}: ${r.error}`).join('\n'),
    ];
    if (hasConflicts) {
      parts.push(
        'Conflicts:\n' +
          needsReplan
            .map((c) => `  ${c.filePath} touched by: ${c.workerIds.join(', ')}`)
            .join('\n'),
      );
    }
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Completed with issues:\n${parts.join('\n')}\nNon-conflicting edits applied. Conflicts resolved by keeping first worker's edits.`,
    });
    return {
      phase: 'verifying',
      steps: state.steps.map((s) => ({ ...s, status: 'failed' as const })),
      currentStepIndex: state.currentStepIndex,
      fileEdits: allEdits,
      toolCallHistory: allHistory,
      messages: newMessages,
      tokenUsage: { input: totalInput, output: totalOutput },
      workerResults: workerSummary,
      executionIssue: {
        kind: 'coordination',
        recoverable: true,
        message: `Coordinator worker errors: ${errors.map((r) => `worker ${r.subtaskId}: ${r.error}`).join('; ')}`,
        nextAction:
          'Retry this task with a narrower plan or single-agent execution before verifying completion.',
        stopReason: null,
      },
    };
  } else if (hasConflicts) {
    // Merge conflicts only (no worker errors) — first worker's edits are kept.
    // Don't set executionIssue so retries aren't wasted on a predictably recurring conflict.
    // Verification will catch any remaining issues.
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Merge conflicts on ${needsReplan.map((c) => c.filePath).join(', ')}. ` +
        `First worker's edits kept. ${allEdits.length} total edits applied. Proceeding to verification.`,
    });
  } else {
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] All ${allResults.length} workers completed successfully. ${merged.length} edits merged.`,
    });
  }

  // 10. Mark steps done via successful worker ownership + edits.
  // A worker can legitimately finish with no edits when it verifies a step is
  // already satisfied, so use both declared task files and actual edit paths.
  const completedSteps = markCompletedStepsFromWorkers(
    state.steps,
    subtasks,
    allResults,
  );

  return {
    phase: 'verifying',
    steps: completedSteps,
    currentStepIndex: completedSteps.length - 1,
    fileEdits: allEdits,
    toolCallHistory: allHistory,
    messages: newMessages,
    tokenUsage: { input: totalInput, output: totalOutput },
    workerResults: workerSummary,
    executionIssue: null,
  };
}
