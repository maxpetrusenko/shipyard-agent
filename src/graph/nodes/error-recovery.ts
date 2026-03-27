/**
 * Error recovery node: handles failures, decides retry vs abort.
 *
 * On retry, rolls back file overlay snapshots so dirty files
 * don't carry over into re-planning.
 *
 * Transient errors (rate limits, timeouts, network) get exponential
 * backoff before retry to avoid hammering APIs.
 */

import { FileOverlay } from '../../tools/file-overlay.js';
import { traceDecision } from '../../runtime/trace-helpers.js';
import type { ShipyardStateType } from '../state.js';

/** Parse typecheck/test error output to identify the files that caused cascading failures. */
function extractCascadeSourceFiles(errorOutput: string | null): string[] {
  if (!errorOutput) return [];
  const fileErrors = new Map<string, number>();
  const lines = errorOutput.split('\n');
  for (const line of lines) {
    // Match TypeScript error format: src/foo/bar.ts(10,5): error TS2305
    const match = line.match(/^([^\s(]+\.tsx?)\(\d+,\d+\):\s*error\s+TS/);
    if (match?.[1]) {
      fileErrors.set(match[1], (fileErrors.get(match[1]) ?? 0) + 1);
    }
  }
  // Sort by error count descending — top files are likely the cascade source
  return [...fileErrors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file, count]) => `${file} (${count} errors)`);
}

/** Build enriched feedback that explains WHY the failure happened. */
function buildEnrichedFeedback(state: ShipyardStateType): string {
  const parts: string[] = [];

  // Include the raw error
  if (state.error) {
    parts.push(`Error: ${state.error}`);
  }

  // Parse verification output for cascade source files
  const verOutput = state.verificationResult?.typecheck_output ?? null;
  const testOutput = state.verificationResult?.test_output ?? null;
  const combinedOutput = [verOutput, testOutput].filter(Boolean).join('\n');
  const cascadeFiles = extractCascadeSourceFiles(combinedOutput);

  if (cascadeFiles.length > 0) {
    parts.push(
      `\nROOT CAUSE: The following files had the most type errors (likely cascade sources):\n` +
      cascadeFiles.map((f) => `  - ${f}`).join('\n'),
    );
    parts.push(
      `\nCRITICAL INSTRUCTIONS FOR RETRY:` +
      `\n- Do NOT directly modify exports of widely-imported files (hub files).` +
      `\n- Before editing any file, run: grep -rl "from.*<filename>" src --include="*.ts" | wc -l` +
      `\n- If a file is imported by >8 other files, use the adapter/re-export pattern:` +
      `\n  1. Create a new implementation file (e.g. foo-v2.ts)` +
      `\n  2. Update the hub file to re-export (preserving ALL existing exports)` +
      `\n  3. Migrate consumers incrementally` +
      `\n- NEVER use full-file rewrite (Tier 4) on hub files. Use surgical edit_file with exact old_string/new_string.`,
    );
  }

  if (state.verificationResult && !state.verificationResult.passed) {
    const newErrors = state.verificationResult.newErrorCount ?? state.verificationResult.error_count;
    const preExisting = state.verificationResult.preExistingErrorCount ?? 0;
    parts.push(
      `\nVerification: ${newErrors} new errors, ${preExisting} pre-existing.`,
    );
  }

  if (parts.length === 0) {
    return 'Unknown error. Please retry with a different approach.';
  }

  return parts.join('\n');
}

/** Classify whether an error is transient (worth retrying with backoff). */
export function isTransientError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('overloaded')
  );
}

/** Exponential backoff with jitter: base * 2^attempt + random jitter. */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

export async function errorRecoveryNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  return traceDecision('error_recovery', {
    reviewDecision: state.reviewDecision,
    retryCount: state.retryCount,
    maxRetries: state.maxRetries,
    error: state.error?.slice(0, 500),
    hasOverlaySnapshots: Boolean(state.fileOverlaySnapshots),
  }, async () => {
    const lastError = state.error ?? state.reviewFeedback ?? 'unknown';

    if (state.reviewDecision === 'escalate') {
      return {
        phase: 'error' as const,
        error: lastError,
      };
    }

    const canRetry = state.retryCount < state.maxRetries;

    if (canRetry) {
      // Exponential backoff for transient errors (rate limits, timeouts).
      // Non-transient errors retry immediately.
      if (isTransientError(state.error)) {
        const delay = backoffMs(state.retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Rollback files from overlay snapshots if available
      if (state.fileOverlaySnapshots) {
        try {
          const overlay = FileOverlay.deserialize(state.fileOverlaySnapshots);
          await overlay.rollbackAll();
        } catch {
          // Best-effort rollback; proceed with retry regardless
        }
      }

      // Decide whether to re-plan or just re-execute: if the issue is a
      // verification/typecheck failure and steps exist, the plan is likely
      // fine — re-execute the current step with enriched feedback instead
      // of discarding the plan entirely. But discovery-limit and first-edit
      // deadline failures indicate the PLAN was wrong, so re-plan those.
      const guardrailMsg = state.executionIssue?.message ?? '';
      const isPlanningGuardrail =
        guardrailMsg.includes('discovery tool calls before first edit exceeded') ||
        guardrailMsg.includes('first edit deadline exceeded');
      const isVerificationFailure =
        (state.executionIssue?.kind === 'guardrail' && !isPlanningGuardrail) ||
        (state.verificationResult && !state.verificationResult.passed);
      const hasSteps = state.steps.length > 0;
      const retryPhase =
        isVerificationFailure && hasSteps
          ? ('executing' as const)
          : ('planning' as const);

      return {
        phase: retryPhase,
        retryCount: state.retryCount + 1,
        error: null,
        fileOverlaySnapshots: null,
        reviewFeedback: buildEnrichedFeedback(state),
        modelHint: 'opus' as const,
      };
    }

    // Fatal: can't retry
    return {
      phase: 'error' as const,
      error: `Fatal: max retries (${state.maxRetries}) exhausted. Last error: ${lastError}`,
    };
  });
}
