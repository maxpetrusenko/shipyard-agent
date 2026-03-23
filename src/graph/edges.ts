/**
 * Conditional edge routing functions for the Shipyard graph.
 */

import type { ShipyardStateType } from './state.js';

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
