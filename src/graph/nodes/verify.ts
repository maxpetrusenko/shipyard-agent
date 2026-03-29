/**
 * Verify node: Run typecheck + tests, parse results.
 */

import { runBash } from '../../tools/bash.js';
import { getRunAbortSignal } from '../../runtime/run-signal.js';
import { WORK_DIR } from '../../config/work-dir.js';
import { detectObservedChangedFiles, getBaselineFingerprint } from '../../runtime/run-baselines.js';
import { traceToolCall } from '../../runtime/trace-helpers.js';
import type {
  ShipyardStateType,
  VerificationResult,
  FileEdit,
} from '../state.js';

export interface VerifyNodeOptions {
  runTests?: 'final_only' | 'always';
}

async function runVerifyStep(
  name: string,
  command: string,
  timeout: number,
  signal?: AbortSignal,
) {
  return traceToolCall(`verify:${name}`, { command }, () =>
    runBash({ command, timeout, cwd: WORK_DIR, signal }),
  );
}

function toSyntheticEdits(files: string[]): FileEdit[] {
  const now = Date.now();
  return files.map((file_path) => ({
    file_path,
    tier: 4 as const,
    old_string: '',
    new_string: '',
    timestamp: now,
  }));
}

function extractErrorLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.includes('error TS')) return true;
      if (/^\s*✗|^\s*×|FAIL\s/.test(line)) return true;
      if (/^\s*\d+:\d+\s+error\s/.test(line)) return true;
      return false;
    });
}

export async function runVerification(
  state: ShipyardStateType,
  opts: VerifyNodeOptions = {},
): Promise<Partial<ShipyardStateType>> {
  // Short-circuit: if execute set a recoverable executionIssue, carry it forward
  // with a synthetic verification note (no point running verification if execute failed)
  if (state.executionIssue?.recoverable) {
    return {
      phase: 'reviewing',
      verificationResult: {
        passed: false,
        error_count: 0,
        newErrorCount: 0,
        typecheck_output: `Skipped verification: ${state.executionIssue.message}`,
      },
      modelHint: 'opus',
    };
  }

  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const runTestsEachStep =
    opts.runTests === 'always' || process.env['SHIPYARD_TEST_EACH_STEP'] === 'true';
  const midStepErrorThreshold = 10;
  const observedFiles = state.fileEdits.length === 0
    ? await detectObservedChangedFiles(state.runId, WORK_DIR)
    : [];
  const effectiveEdits = state.fileEdits.length > 0
    ? state.fileEdits
    : toSyntheticEdits(observedFiles);

  if (effectiveEdits.length === 0) {
    return {
      phase: 'reviewing',
      verificationResult: {
        passed: true,
        error_count: 0,
        newErrorCount: 0,
        typecheck_output: 'Skipped verification (no file edits in run).',
      },
      fileEdits: effectiveEdits,
      modelHint: 'opus',
    };
  }

  const baseline = await getBaselineFingerprint(state.runId);
  const signal = getRunAbortSignal() ?? undefined;
  const results: VerificationResult = {
    passed: true,
    error_count: 0,
  };
  if (baseline) {
    results.baselineFingerprint = baseline.hash;
  }

  // Mid-step lightweight typecheck: catch error cascades early before running full verify
  // Skip if no baseline — we can't distinguish new vs pre-existing errors without it,
  // and large projects may have hundreds of pre-existing errors that would false-positive.
  // Use `pnpm type-check` (per-package) rather than bare `npx tsc` which may use a root
  // tsconfig that includes all packages and report thousands of false positives in monorepos.
  if (hasMoreSteps && baseline) {
    const lightTsc = await runVerifyStep(
      'lightweight-typecheck',
      'pnpm type-check 2>&1',
      120_000,
      signal,
    );
    if (lightTsc.message === 'Run cancelled by user') {
      return { phase: 'error', error: lightTsc.message, verificationResult: results, modelHint: 'opus' };
    }
    if (!lightTsc.success) {
      const lightOutput = lightTsc.stdout + lightTsc.stderr;
      const lightErrors = lightOutput.split('\n').filter((l) => l.includes('error TS'));
      const baselineSet = new Set(baseline.errorLines);
      const newLightErrors = lightErrors.filter((e) => !baselineSet.has(e.trim()));
      if (newLightErrors.length > midStepErrorThreshold) {
        results.passed = false;
        results.error_count = newLightErrors.length;
        results.newErrorCount = newLightErrors.length;
        results.typecheck_output = `[Mid-step check] ${newLightErrors.length} new TS errors (threshold: ${midStepErrorThreshold}):\n${newLightErrors.slice(0, 30).join('\n')}`;
        return {
          phase: 'reviewing',
          verificationResult: results,
          fileEdits: effectiveEdits,
          modelHint: 'opus',
          executionIssue: {
            kind: 'guardrail' as const,
            recoverable: true,
            message: `Mid-step typecheck found ${newLightErrors.length} new errors (>${midStepErrorThreshold}). Retry this step.`,
            nextAction: 'Review the errors and retry this step with corrections.',
            stopReason: null,
          },
        };
      }
    }
  }

  // Run ALL stages unconditionally so baseline diffing can compare the full picture.
  // A pre-existing lint failure must not mask a new typecheck or test regression.

  // Lint (optional; skip cleanly if no lint script in package)
  const lint = await runVerifyStep('lint', 'pnpm run lint --if-present 2>&1', 120_000, signal);
  if (lint.message === 'Run cancelled by user') {
    return { phase: 'error', error: lint.message, verificationResult: results, modelHint: 'opus' };
  }
  if (!lint.success) {
    results.passed = false;
    results.error_count += 1;
    results.typecheck_output = `${lint.stdout}${lint.stderr}`;
  }

  // Typecheck — always run regardless of lint result
  const tsc = await runVerifyStep('typecheck', 'pnpm type-check 2>&1', 120_000, signal);
  if (tsc.message === 'Run cancelled by user') {
    return { phase: 'error', error: tsc.message, verificationResult: results, modelHint: 'opus' };
  }
  {
    const tscOutput = tsc.stdout + tsc.stderr;
    // Append to existing typecheck_output (may contain lint output)
    results.typecheck_output = results.typecheck_output
      ? `${results.typecheck_output}\n${tscOutput}`
      : tscOutput;
    if (!tsc.success) {
      results.passed = false;
      const errorLines = tscOutput.split('\n').filter((l) => l.includes('error TS'));
      results.error_count += errorLines.length;
    }
  }

  // Tests — always run on final step (or each step if opted in), regardless of lint/typecheck
  if (!hasMoreSteps || runTestsEachStep) {
    const test = await runVerifyStep('test', 'pnpm test 2>&1', 300_000, signal);
    if (test.message === 'Run cancelled by user') {
      return { phase: 'error', error: test.message, verificationResult: results, modelHint: 'opus' };
    }
    results.test_output = test.stdout + test.stderr;
    if (!test.success) {
      results.passed = false;
      const failLines = (test.stdout + test.stderr)
        .split('\n')
        .filter((l) => l.includes('FAIL') || l.includes('✗') || l.includes('×'));
      results.error_count += failLines.length;
    }
  }

  // Compute baseline diff: how many errors are new vs pre-existing
  if (baseline && !results.passed) {
    const allErrorOutput = [
      results.typecheck_output ?? '',
      results.test_output ?? '',
    ].join('\n');
    const currentErrors = extractErrorLines(allErrorOutput).sort();
    const baselineSet = new Set(baseline.errorLines);
    const newErrors = currentErrors.filter((e) => !baselineSet.has(e));
    results.preExistingErrorCount = Math.max(0, currentErrors.length - newErrors.length);
    results.newErrorCount = newErrors.length;
    // If all errors were pre-existing, the run didn't introduce regressions
    if (newErrors.length === 0) {
      results.passed = true;
    }
  } else if (results.passed) {
    results.newErrorCount = 0;
    results.preExistingErrorCount = 0;
  }

  return {
    phase: 'reviewing',
    verificationResult: results,
    fileEdits: effectiveEdits,
    modelHint: 'opus',
  };
}

export async function verifyNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  return runVerification(state);
}
