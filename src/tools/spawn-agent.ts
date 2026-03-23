/**
 * spawn_agent tool: creates an isolated sub-graph invocation.
 *
 * MVP: runs sequentially (no parallel workers yet).
 */

import { runWorker, type WorkerResult } from '../multi-agent/worker.js';
import type { ContextEntry } from '../graph/state.js';

export interface SpawnAgentParams {
  task: string;
  role?: string;
  contexts?: ContextEntry[];
}

export async function spawnAgent(
  params: SpawnAgentParams,
): Promise<WorkerResult> {
  const { task, role, contexts = [] } = params;

  // Add role context if provided
  if (role) {
    contexts.push({
      label: 'Agent Role',
      content: `You are acting as a ${role} specialist.`,
      source: 'system',
    });
  }

  return runWorker(`sub-${Date.now()}`, task, contexts);
}
