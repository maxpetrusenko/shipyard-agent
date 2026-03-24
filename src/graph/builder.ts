/**
 * Shipyard graph builder.
 *
 * Wires nodes + conditional edges into a compiled LangGraph StateGraph.
 *
 * Flow:
 *   START -> gate -> (end | plan) -> execute -> verify -> review
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
import { coordinateNode } from './nodes/coordinate.js';
import { afterGate, afterPlan, afterReview, afterErrorRecovery } from './edges.js';
import { gateNode } from './nodes/gate.js';

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * Flow:
 *   START -> gate ─ plan ──┬── execute -> verify -> review
 *        └ end (Q&A only)
 *                   │                          ├─ continue -> execute
 *                   │                          ├─ done -> report -> END
 *                   │                          ├─ retry -> plan
 *                   │                          └─ escalate -> error_recovery
 *                   │                                          ├─ plan (retry)
 *                   │                                          └─ report (fatal) -> END
 *                   └── coordinate -> verify -> review (multi-agent path)
 */
export interface CreateShipyardGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export function createShipyardGraph(opts?: CreateShipyardGraphOptions) {
  const graph = new StateGraph(ShipyardState)
    .addNode('gate', gateNode)
    .addNode('plan', planNode)
    .addNode('execute', executeNode)
    .addNode('coordinate', coordinateNode)
    .addNode('verify', verifyNode)
    .addNode('review', reviewNode)
    .addNode('error_recovery', errorRecoveryNode)
    .addNode('report', reportNode);

  graph.addEdge(START, 'gate');
  graph.addConditionalEdges('gate', afterGate, {
    plan: 'plan',
    end: END,
  });

  // Conditional: after plan -> coordinate (multi-agent) or execute (single)
  graph.addConditionalEdges('plan', afterPlan, {
    coordinate: 'coordinate',
    execute: 'execute',
  });

  // Both execute and coordinate flow into verify
  graph.addEdge('execute', 'verify');
  graph.addEdge('coordinate', 'verify');
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
