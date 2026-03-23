/**
 * Verify node: Run typecheck + tests, parse results.
 */

import { runBash } from '../../tools/bash.js';
import type { ShipyardStateType, VerificationResult } from '../state.js';

export async function verifyNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const results: VerificationResult = {
    passed: true,
    error_count: 0,
  };

  // Typecheck
  const tsc = await runBash({
    command: 'npx tsc --noEmit 2>&1',
    timeout: 60_000,
  });

  results.typecheck_output = tsc.stdout + tsc.stderr;
  if (!tsc.success) {
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
      command: 'npx vitest run --reporter=verbose 2>&1',
      timeout: 120_000,
    });

    results.test_output = test.stdout + test.stderr;
    if (!test.success) {
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
