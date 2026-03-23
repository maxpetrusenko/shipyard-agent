/**
 * Coordinate node: orchestrates multi-agent parallel execution.
 *
 * When the plan has multiple independent steps, this node:
 * 1. Uses the supervisor to decompose the instruction into subtasks
 * 2. Dispatches workers sequentially (parallel-safe but sequential for now)
 * 3. Merges results and detects file conflicts
 * 4. Feeds merged edits + tool history back into state for verify
 */

import { decomposeTask } from '../../multi-agent/supervisor.js';
import { runWorker, type WorkerResult } from '../../multi-agent/worker.js';
import { detectConflicts, mergeEdits } from '../../multi-agent/merge.js';
import type {
  ShipyardStateType,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
} from '../state.js';

// ---------------------------------------------------------------------------
// shouldCoordinate — gate for multi-agent path
// ---------------------------------------------------------------------------

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
  const { subtasks, sequentialPairs } = await decomposeTask(state.instruction);

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

  // 3. Dispatch independent workers (parallel via Promise.all)
  const parallelResults = await Promise.all(
    independent.map((task) =>
      runWorker(task.id, task.description, state.contexts),
    ),
  );

  // 4. Dispatch sequential workers one at a time
  const sequentialResults: WorkerResult[] = [];
  for (const task of sequential) {
    const result = await runWorker(task.id, task.description, state.contexts);
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

  if (errors.length > 0 || hasConflicts) {
    const parts: string[] = [];
    if (errors.length > 0) {
      parts.push(
        'Errors:\n' +
          errors.map((r) => `  Worker ${r.subtaskId}: ${r.error}`).join('\n'),
      );
    }
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
  } else {
    newMessages.push({
      role: 'assistant',
      content: `[Coordinator] All ${allResults.length} workers completed successfully. ${merged.length} edits merged.`,
    });
  }

  // 10. Mark all steps as done (workers handled execution)
  const completedSteps = state.steps.map((s) => ({ ...s, status: 'done' as const }));

  return {
    phase: 'verifying',
    steps: completedSteps,
    currentStepIndex: completedSteps.length - 1,
    fileEdits: allEdits,
    toolCallHistory: allHistory,
    messages: newMessages,
    tokenUsage: { input: totalInput, output: totalOutput },
    workerResults: allResults.map((r) => ({
      subtaskId: r.subtaskId,
      phase: r.phase,
      editCount: r.fileEdits.length,
      toolCallCount: r.toolCallHistory.length,
      error: r.error,
      durationMs: r.durationMs,
    })),
  };
}
