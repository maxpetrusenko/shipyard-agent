/**
 * Conditional edge routing functions for the Shipyard graph.
 */

import type { ShipyardStateType } from './state.js';
import { shouldCoordinate } from './nodes/coordinate.js';

/**
 * After plan: route to coordinate (multi-agent) or execute (single-agent).
 */
export function afterPlan(
  state: ShipyardStateType,
): 'coordinate' | 'execute' {
  return shouldCoordinate(state) ? 'coordinate' : 'execute';
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
): 'plan' | 'report' {
  if (state.phase === 'planning') {
    return 'plan';
  }
  return 'report';
}
