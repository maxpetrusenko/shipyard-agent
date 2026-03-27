import { describe, expect, it } from 'vitest';

import {
  backoffMs,
  errorRecoveryNode,
  isTransientError,
} from '../../src/graph/nodes/error-recovery.js';

function baseState() {
  return {
    runId: 'run-error-recovery',
    traceId: 'trace-error-recovery',
    instruction: 'fix explicit target',
    phase: 'error',
    steps: [],
    currentStepIndex: 0,
    fileEdits: [],
    toolCallHistory: [],
    verificationResult: null,
    reviewDecision: 'retry',
    reviewFeedback: null,
    contexts: [],
    messages: [],
    error: null,
    retryCount: 0,
    maxRetries: 3,
    tokenUsage: null,
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    loopDiagnostics: null,
    executeDiagnostics: null,
    executionIssue: null,
    modelHint: null,
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
  } as const;
}

describe('errorRecoveryNode', () => {
  it('does not retry reviewer escalations and preserves concrete blocker text', async () => {
    const out = await errorRecoveryNode({
      ...baseState(),
      reviewDecision: 'escalate',
      reviewFeedback:
        'Explicit target /repo/src/server/run-debug.ts is missing after repository search. Ask for the correct path or broaden scope.',
    } as any);

    expect(out.phase).toBe('error');
    expect(out.retryCount).toBeUndefined();
    expect(out.error).toContain('/repo/src/server/run-debug.ts');
    expect(out.error).not.toContain('unknown');
  });

  it('uses review feedback instead of unknown when retries are exhausted', async () => {
    const out = await errorRecoveryNode({
      ...baseState(),
      reviewDecision: 'retry',
      reviewFeedback: 'Instruction required code edits but no file changes were recorded.',
      retryCount: 3,
    } as any);

    expect(out.phase).toBe('error');
    expect(out.error).toContain('Instruction required code edits');
    expect(out.error).not.toContain('unknown');
  });
});

describe('isTransientError', () => {
  it.each([
    'Rate limit exceeded',
    'Error 429: too many requests',
    'Request timeout after 30s',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:443',
    'Service Unavailable (503)',
    '502 Bad Gateway',
    'API is overloaded',
  ])('detects transient pattern: %s', (msg) => {
    expect(isTransientError(msg)).toBe(true);
  });

  it('returns false for null input', () => {
    expect(isTransientError(null)).toBe(false);
  });

  it.each([
    'TypeError: Cannot read property x of undefined',
    'SyntaxError: Unexpected token',
    'File not found: /tmp/missing.ts',
    'Permission denied',
    '',
  ])('rejects non-transient error: %s', (msg) => {
    expect(isTransientError(msg)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isTransientError('RATE LIMIT hit')).toBe(true);
    expect(isTransientError('TIMEOUT on request')).toBe(true);
  });
});

describe('backoffMs', () => {
  it('returns between base and 2*base for attempt 0', () => {
    const result = backoffMs(0, 500, 30_000);
    expect(result).toBeGreaterThanOrEqual(500);
    expect(result).toBeLessThanOrEqual(1000);
  });

  it('grows exponentially with attempt', () => {
    // attempt 3: 500 * 2^3 = 4000, plus jitter 0-500 → 4000-4500
    const result = backoffMs(3, 500, 30_000);
    expect(result).toBeGreaterThanOrEqual(4000);
    expect(result).toBeLessThanOrEqual(4500);
  });

  it('caps at maxMs for high attempts', () => {
    // attempt 6: 500 * 2^6 = 32000, exceeds 30000 cap
    const result = backoffMs(6, 500, 30_000);
    expect(result).toBeLessThanOrEqual(30_000);
  });

  it('caps at maxMs for very high attempts', () => {
    const result = backoffMs(20, 500, 30_000);
    expect(result).toBeLessThanOrEqual(30_000);
  });

  it('respects custom base and max', () => {
    const result = backoffMs(0, 1000, 5000);
    expect(result).toBeGreaterThanOrEqual(1000);
    expect(result).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for failure classes
// ---------------------------------------------------------------------------

describe('verification failure recovery', () => {
  it('retries to executing (not planning) on verification guardrail failures', async () => {
    // Failure class: verification finds new errors but recovery fails (runs 6a9c4969, etc.)
    // Root cause: recovery went back to planning, discarding the plan + wasting retries
    const out = await errorRecoveryNode({
      ...baseState(),
      steps: [
        { index: 0, description: 'Edit file', files: ['src/a.ts'], status: 'done' },
        { index: 1, description: 'Edit file B', files: ['src/b.ts'], status: 'pending' },
      ],
      reviewDecision: 'retry',
      executionIssue: {
        kind: 'guardrail',
        recoverable: true,
        message: 'Mid-step typecheck found 5 new errors (>10). Retry this step.',
        nextAction: 'Review the errors and retry this step with corrections.',
        stopReason: null,
      },
      verificationResult: {
        passed: false,
        error_count: 5,
        newErrorCount: 5,
        typecheck_output: 'src/a.ts(10,5): error TS2305: Module has no exported member.',
      },
    } as any);

    expect(out.phase).toBe('executing');
    expect(out.retryCount).toBe(1);
    expect(out.reviewFeedback).toContain('error');
  });

  it('retries to planning for non-verification failures', async () => {
    const out = await errorRecoveryNode({
      ...baseState(),
      steps: [
        { index: 0, description: 'Edit file', files: ['src/a.ts'], status: 'pending' },
      ],
      reviewDecision: 'retry',
      error: 'The work is incomplete.',
    } as any);

    expect(out.phase).toBe('planning');
    expect(out.retryCount).toBe(1);
  });

  it('enriched feedback includes cascade source files', async () => {
    const out = await errorRecoveryNode({
      ...baseState(),
      steps: [
        { index: 0, description: 'Edit file', files: ['src/a.ts'], status: 'done' },
      ],
      reviewDecision: 'retry',
      error: 'Type errors introduced',
      verificationResult: {
        passed: false,
        error_count: 20,
        newErrorCount: 20,
        typecheck_output: [
          'src/auth.ts(10,5): error TS2305: foo',
          'src/auth.ts(15,3): error TS2305: bar',
          'src/auth.ts(20,1): error TS2305: baz',
          'src/utils.ts(5,1): error TS2305: qux',
        ].join('\n'),
      },
    } as any);

    expect(out.phase).toBe('executing');
    expect(out.reviewFeedback).toContain('auth.ts');
    expect(out.reviewFeedback).toContain('ROOT CAUSE');
    expect(out.reviewFeedback).toContain('adapter/re-export');
  });
});
