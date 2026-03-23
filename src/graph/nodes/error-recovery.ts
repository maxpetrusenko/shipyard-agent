/**
 * Error recovery node: handles failures, decides retry vs abort.
 */

import type { ShipyardStateType } from '../state.js';

export async function errorRecoveryNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const canRetry = state.retryCount < state.maxRetries;

  if (canRetry) {
    return {
      phase: 'planning',
      retryCount: state.retryCount + 1,
      error: null,
      reviewFeedback: state.error
        ? `Error occurred: ${state.error}. Please retry with a different approach.`
        : null,
      modelHint: 'opus',
    };
  }

  // Fatal: can't retry
  return {
    phase: 'error',
    error: `Fatal: max retries (${state.maxRetries}) exhausted. Last error: ${state.error ?? 'unknown'}`,
  };
}
