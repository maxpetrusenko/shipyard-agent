/**
 * Worker: isolated graph invocation for a subtask.
 *
 * Each worker gets its own context window and tool set.
 * Returns a summary to the supervisor.
 */

import { createShipyardGraph } from '../graph/builder.js';
import { v4 as uuid } from 'uuid';
import type { ShipyardStateType, ContextEntry } from '../graph/state.js';

export interface WorkerResult {
  subtaskId: string;
  phase: ShipyardStateType['phase'];
  fileEdits: ShipyardStateType['fileEdits'];
  tokenUsage: ShipyardStateType['tokenUsage'];
  error: string | null;
  durationMs: number;
}

export async function runWorker(
  subtaskId: string,
  instruction: string,
  contexts: ContextEntry[],
): Promise<WorkerResult> {
  const graph = createShipyardGraph();
  const runId = uuid();
  const startedAt = Date.now();

  try {
    const result = (await graph.invoke(
      {
        runId,
        traceId: uuid(),
        instruction,
        phase: 'planning',
        steps: [],
        currentStepIndex: 0,
        fileEdits: [],
        toolCallHistory: [],
        verificationResult: null,
        reviewDecision: null,
        reviewFeedback: null,
        contexts,
        messages: [],
        error: null,
        retryCount: 0,
        maxRetries: 2,
        tokenUsage: null,
        traceUrl: null,
        runStartedAt: startedAt,
        workerResults: [],
        modelHint: 'opus',
      },
      { configurable: { thread_id: runId } },
    )) as ShipyardStateType;

    return {
      subtaskId,
      phase: result.phase,
      fileEdits: result.fileEdits,
      tokenUsage: result.tokenUsage,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: unknown) {
    return {
      subtaskId,
      phase: 'error',
      fileEdits: [],
      tokenUsage: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
