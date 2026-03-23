/**
 * Coordinate node: orchestrates multi-agent parallel execution.
 *
 * When the plan has multiple independent steps, this node:
 * 1. Groups steps by file independence (supervisor decomposition)
 * 2. Dispatches workers in parallel for non-overlapping groups
 * 3. Merges results and detects conflicts
 * 4. Feeds merged edits back into state
 */

import { decomposeTask } from '../../multi-agent/supervisor.js';
import { runWorker, type WorkerResult } from '../../multi-agent/worker.js';
import { detectConflicts, mergeEdits } from '../../multi-agent/merge.js';
import type { ShipyardStateType, FileEdit, LLMMessage } from '../state.js';

/**
 * Determine whether the plan benefits from multi-agent coordination.
 * Returns true if there are 2+ steps that don't share files.
 */
export function shouldCoordinate(state: ShipyardStateType): boolean {
  if (state.steps.length < 2) return false;

  // Check for file independence between steps
  const allFiles = state.steps.map((s) => new Set(s.files));
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      const overlap = [...(allFiles[i] ?? [])].some((f) => allFiles[j]?.has(f));
      if (!overlap && (allFiles[i]?.size ?? 0) > 0 && (allFiles[j]?.size ?? 0) > 0) {
        return true; // At least 2 steps with no file overlap
      }
    }
  }
  return false;
}

export async function coordinateNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const newMessages: LLMMessage[] = [...state.messages];
  const startTokens = state.tokenUsage ?? { input: 0, output: 0 };

  // Use supervisor to decompose into parallel subtasks
  const { subtasks, sequentialPairs } = await decomposeTask(state.instruction);

  if (subtasks.length <= 1) {
    // Not worth parallelizing — fall through to normal execute
    return {
      phase: 'executing',
      workerResults: [],
    };
  }

  newMessages.push({
    role: 'assistant',
    content: `[Coordinator] Decomposed into ${subtasks.length} parallel subtasks. Dispatching workers...`,
  });

  // Build dependency graph from sequential pairs
  const blocked = new Set<string>();
  for (const [, after] of sequentialPairs) {
    if (after) blocked.add(after);
  }

  // Dispatch independent subtasks in parallel
  const independent = subtasks.filter((t) => !blocked.has(t.id));
  const sequential = subtasks.filter((t) => blocked.has(t.id));

  // Run independent workers in parallel
  const parallelResults = await Promise.all(
    independent.map((task) =>
      runWorker(task.id, task.description, state.contexts),
    ),
  );

  // Run sequential workers one at a time
  const sequentialResults: WorkerResult[] = [];
  for (const task of sequential) {
    const result = await runWorker(task.id, task.description, state.contexts);
    sequentialResults.push(result);
  }

  const allResults = [...parallelResults, ...sequentialResults];

  // Detect and resolve conflicts
  const conflicts = detectConflicts(allResults);
  const { merged, needsReplan } = mergeEdits(allResults, conflicts);

  // Aggregate token usage
  let totalInput = startTokens.input;
  let totalOutput = startTokens.output;
  for (const r of allResults) {
    if (r.tokenUsage) {
      totalInput += r.tokenUsage.input;
      totalOutput += r.tokenUsage.output;
    }
  }

  // Aggregate file edits
  const allEdits: FileEdit[] = [...state.fileEdits, ...merged];

  // Check for errors
  const errors = allResults.filter((r) => r.error);
  const hasConflicts = needsReplan.length > 0;

  if (errors.length > 0 || hasConflicts) {
    const errorSummary = errors.map((r) => `Worker ${r.subtaskId}: ${r.error}`).join('\n');
    const conflictSummary = needsReplan
      .map((c) => `File ${c.filePath} touched by workers: ${c.workerIds.join(', ')}`)
      .join('\n');

    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] Completed with issues:\n${errorSummary}\n${conflictSummary}\nNon-conflicting edits applied. Conflicts need manual resolution.`,
    });
  } else {
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] All ${allResults.length} workers completed successfully. ${merged.length} edits merged.`,
    });
  }

  // Mark all steps as done (workers handled execution)
  const completedSteps = state.steps.map((s) => ({ ...s, status: 'done' as const }));

  return {
    phase: 'verifying',
    steps: completedSteps,
    currentStepIndex: completedSteps.length - 1,
    fileEdits: allEdits,
    messages: newMessages,
    tokenUsage: { input: totalInput, output: totalOutput },
    workerResults: allResults.map((r) => ({
      subtaskId: r.subtaskId,
      phase: r.phase,
      editCount: r.fileEdits.length,
      error: r.error,
      durationMs: r.durationMs,
    })),
  };
}
