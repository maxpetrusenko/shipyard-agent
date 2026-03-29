/**
 * Conditional edge routing functions for the Shipyard graph.
 */

import type { ShipyardStateType } from './state.js';
/**
 * After gate: Q&A-only runs end here; otherwise continue to planning.
 */
export function afterGate(state: ShipyardStateType): 'plan' | 'coordinate' | 'execute' | 'end' {
  if (state.gateRoute === 'coordinate') return 'coordinate';
  if (state.gateRoute === 'execute') return 'execute';
  return state.gateRoute === 'end' ? 'end' : 'plan';
}

/**
 * After plan: default to worker orchestration; fall back to execute only when
 * coordination is explicitly disabled for recovery.
 */
export function afterPlan(
  state: ShipyardStateType,
): 'coordinate' | 'execute' {
  return !state.forceSequential && state.steps.length > 0 ? 'coordinate' : 'execute';
}

/**
 * After review: route based on decision.
 *
 * continue -> execute (next step)
 * done -> report
 * retry -> plan (with feedback)
 * escalate -> error_recovery
 */
export function afterReview(
  state: ShipyardStateType,
): 'execute' | 'report' | 'plan' | 'error_recovery' {
  switch (state.reviewDecision) {
    case 'continue':
      return 'execute';
    case 'done':
      return 'report';
    case 'retry':
      return 'plan';
    case 'escalate':
    default:
      return 'error_recovery';
  }
}

/**
 * After error recovery: retry or report failure.
 */
export function afterErrorRecovery(
  state: ShipyardStateType,
): 'plan' | 'execute' | 'report' {
  if (state.phase === 'planning') {
    return 'plan';
  }
  if (state.phase === 'executing') {
    return 'execute';
  }
  return 'report';
}
