/**
 * Verify node: Run typecheck + tests, parse results.
 */

import { runBash } from '../../tools/bash.js';
import { getRunAbortSignal } from '../../runtime/run-signal.js';
import { WORK_DIR } from '../../config/work-dir.js';
import type { ShipyardStateType, VerificationResult } from '../state.js';

export async function verifyNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const signal = getRunAbortSignal() ?? undefined;
  const results: VerificationResult = {
    passed: true,
    error_count: 0,
  };

  // Typecheck — run in target workdir
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

  // Tests (only if typecheck passes — no point running tests with type errors)
  if (results.passed) {
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
    modelHint: 'opus',
  };
}
