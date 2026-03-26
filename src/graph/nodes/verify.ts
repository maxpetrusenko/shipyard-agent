/**
 * Verify node: Run typecheck + tests, parse results.
 */

import { runBash } from '../../tools/bash.js';
import { getRunAbortSignal } from '../../runtime/run-signal.js';
import { WORK_DIR } from '../../config/work-dir.js';
import { detectObservedChangedFiles } from '../../runtime/run-baselines.js';
import type {
  ShipyardStateType,
  VerificationResult,
  FileEdit,
} from '../state.js';

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

export async function verifyNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const runTestsEachStep = process.env['SHIPYARD_TEST_EACH_STEP'] === 'true';
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
        typecheck_output: 'Skipped verification (no file edits in run).',
      },
      fileEdits: effectiveEdits,
      modelHint: 'opus',
    };
  }

  const signal = getRunAbortSignal() ?? undefined;
  const results: VerificationResult = {
    passed: true,
    error_count: 0,
  };

  // Lint (optional; skip cleanly if no lint script in package)
  const lint = await runBash({
    command: 'pnpm run lint --if-present 2>&1',
    timeout: 120_000,
    cwd: WORK_DIR,
    signal,
  });
  if (!lint.success) {
    if (lint.message === 'Run cancelled by user') {
      return {
        phase: 'error',
        error: lint.message,
        verificationResult: results,
        modelHint: 'opus',
      };
    }
    results.passed = false;
    results.error_count += 1;
    results.typecheck_output = `${lint.stdout}${lint.stderr}`;
  }

  // Typecheck — run in target workdir
  if (results.passed) {
    const tsc = await runBash({
      command: 'pnpm type-check 2>&1',
      timeout: 120_000,
      cwd: WORK_DIR,
      signal,
    });

    results.typecheck_output = tsc.stdout + tsc.stderr;
    if (!tsc.success) {
      if (tsc.message === 'Run cancelled by user') {
        return {
          phase: 'error',
          error: tsc.message,
          verificationResult: results,
          modelHint: 'opus',
        };
      }
      results.passed = false;
      // Count error lines (TS errors start with file path)
      const errorLines = (tsc.stdout + tsc.stderr)
        .split('\n')
        .filter((l) => l.includes('error TS'));
      results.error_count += errorLines.length;
    }
  }

  // Tests: run on final step by default; opt-in each step via SHIPYARD_TEST_EACH_STEP=true
  if (results.passed && (!hasMoreSteps || runTestsEachStep)) {
    const test = await runBash({
      command: 'pnpm test 2>&1',
      timeout: 300_000,
      cwd: WORK_DIR,
      signal,
    });

    results.test_output = test.stdout + test.stderr;
    if (!test.success) {
      if (test.message === 'Run cancelled by user') {
        return {
          phase: 'error',
          error: test.message,
          verificationResult: results,
          modelHint: 'opus',
        };
      }
      results.passed = false;
      const failLines = (test.stdout + test.stderr)
        .split('\n')
        .filter((l) => l.includes('FAIL') || l.includes('✗') || l.includes('×'));
      results.error_count += failLines.length;
    }
  }

  return {
    phase: 'reviewing',
    verificationResult: results,
    fileEdits: effectiveEdits,
    modelHint: 'opus',
  };
}
