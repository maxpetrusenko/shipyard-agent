/**
 * Transient-error retry wrapper for LLM API calls.
 *
 * Uses the same isTransientError + backoffMs from error-recovery,
 * and the abort-aware sleep from abort-sleep.
 */
import { isTransientError, backoffMs } from '../graph/nodes/error-recovery.js';
import { sleep } from '../runtime/abort-sleep.js';
import { getRunAbortSignal } from '../runtime/run-signal.js';

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Retry `fn` up to `maxAttempts` times for transient errors (429, 503, timeouts, etc.).
 * Respects the run abort signal between retries.
 * Non-transient errors are thrown immediately without retry.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; label?: string },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const label = opts?.label ?? 'LLM call';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const signal = getRunAbortSignal();
      if (signal?.aborted) throw err;

      const msg = err instanceof Error ? err.message : String(err);

      if (!isTransientError(msg) || attempt >= maxAttempts - 1) {
        throw err;
      }

      const delay = backoffMs(attempt);
      console.warn(
        `[${label}] Transient error (attempt ${attempt + 1}/${maxAttempts}), retrying in ${Math.round(delay)}ms: ${msg.slice(0, 200)}`,
      );
      await sleep(delay, signal);
    }
  }

  // Unreachable — loop always returns or throws
  throw new Error(`${label}: exhausted ${maxAttempts} attempts`);
}
