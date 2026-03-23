/**
 * Shipyard graph builder.
 *
 * Wires nodes + conditional edges into a compiled LangGraph StateGraph.
 *
 * Flow:
 *   START -> plan -> execute -> verify -> review
 *                                          ├─ continue -> execute
 *                                          ├─ done -> report -> END
 *                                          ├─ retry -> plan
 *                                          └─ escalate -> error_recovery
 *                                                          ├─ plan (retry)
 *                                                          └─ report (fatal) -> END
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { ShipyardState } from './state.js';
import { planNode } from './nodes/plan.js';
import { executeNode } from './nodes/execute.js';
import { verifyNode } from './nodes/verify.js';
import { reviewNode } from './nodes/review.js';
import { errorRecoveryNode } from './nodes/error-recovery.js';
import { reportNode } from './nodes/report.js';
import { afterReview, afterErrorRecovery } from './edges.js';

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface CreateShipyardGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export function createShipyardGraph(opts?: CreateShipyardGraphOptions) {
  const graph = new StateGraph(ShipyardState)
    .addNode('plan', planNode)
    .addNode('execute', executeNode)
    .addNode('verify', verifyNode)
    .addNode('review', reviewNode)
    .addNode('error_recovery', errorRecoveryNode)
    .addNode('report', reportNode);

  // Linear chain: START -> plan -> execute -> verify -> review
  graph.addEdge(START, 'plan');
  graph.addEdge('plan', 'execute');
  graph.addEdge('execute', 'verify');
  graph.addEdge('verify', 'review');

  // Conditional: after review
  graph.addConditionalEdges('review', afterReview, {
    execute: 'execute',
    report: 'report',
    plan: 'plan',
    error_recovery: 'error_recovery',
  });

  // Conditional: after error recovery
  graph.addConditionalEdges('error_recovery', afterErrorRecovery, {
    plan: 'plan',
    report: 'report',
  });

  // Terminal
  graph.addEdge('report', END);

  return graph.compile({
    checkpointer: opts?.checkpointer,
  });
}
