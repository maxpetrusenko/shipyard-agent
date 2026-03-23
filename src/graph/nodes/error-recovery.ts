/**
 * Error recovery node: handles failures, decides retry vs abort.
 *
 * On retry, rolls back file overlay snapshots so dirty files
 * don't carry over into re-planning.
 */

import { FileOverlay } from '../../tools/file-overlay.js';
import type { ShipyardStateType } from '../state.js';

export async function errorRecoveryNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const canRetry = state.retryCount < state.maxRetries;

  if (canRetry) {
    // Rollback files from overlay snapshots if available
    if (state.fileOverlaySnapshots) {
      try {
        const paths = Object.keys(
          JSON.parse(state.fileOverlaySnapshots) as Record<string, string>,
        );
        const overlay = new FileOverlay();
        for (const p of paths) {
          await overlay.snapshot(p);
        }
        await overlay.rollbackAll();
      } catch {
        // Best-effort rollback; proceed with retry regardless
      }
    }

    return {
      phase: 'planning',
      retryCount: state.retryCount + 1,
      error: null,
      fileOverlaySnapshots: null,
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
