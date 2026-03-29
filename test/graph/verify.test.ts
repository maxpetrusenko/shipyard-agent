import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBash: vi.fn(),
  getRunAbortSignal: vi.fn(),
  detectObservedChangedFiles: vi.fn(),
  getBaselineFingerprint: vi.fn(),
}));

vi.mock('../../src/tools/bash.js', () => ({
  runBash: mocks.runBash,
}));

vi.mock('../../src/runtime/run-signal.js', () => ({
  getRunAbortSignal: mocks.getRunAbortSignal,
}));

vi.mock('../../src/runtime/run-baselines.js', () => ({
  detectObservedChangedFiles: mocks.detectObservedChangedFiles,
  getBaselineFingerprint: mocks.getBaselineFingerprint,
}));

vi.mock('../../src/runtime/trace-helpers.js', () => ({
  traceToolCall: (_name: string, _meta: unknown, fn: () => unknown) => fn(),
}));

import { runVerification, verifyNode } from '../../src/graph/nodes/verify.js';

function baseState() {
  return {
    runId: 'run-verify',
    traceId: 'trace-verify',
    instruction: 'validate',
    phase: 'verifying',
    steps: [{ index: 0, description: 'x', files: [], status: 'done' }],
    currentStepIndex: 0,
    fileEdits: [],
    toolCallHistory: [],
    verificationResult: null,
    reviewDecision: null,
    reviewFeedback: null,
    contexts: [],
    messages: [],
    error: null,
    retryCount: 0,
    maxRetries: 3,
    tokenUsage: { input: 0, output: 0 },
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    modelHint: null,
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
    executionIssue: null,
  } as const;
}

describe('verifyNode', () => {
  beforeEach(() => {
    mocks.runBash.mockReset();
    mocks.getRunAbortSignal.mockReset();
    mocks.detectObservedChangedFiles.mockReset();
    mocks.getBaselineFingerprint.mockReset();
    mocks.getRunAbortSignal.mockReturnValue(null);
    mocks.getBaselineFingerprint.mockReturnValue(null);
  });

  it('runs verification when observed git changes exist even if fileEdits is empty', async () => {
    mocks.detectObservedChangedFiles.mockResolvedValue(['/repo/scripts/check-empty-tests.sh']);
    mocks.runBash.mockResolvedValue({
      success: true,
      exit_code: 0,
      stdout: '',
      stderr: '',
    });

    const out = await verifyNode(baseState() as any);

    expect(out.phase).toBe('reviewing');
    expect(out.fileEdits).toHaveLength(1);
    expect(out.verificationResult?.passed).toBe(true);
    expect(mocks.runBash).toHaveBeenCalledTimes(3);
    expect(mocks.runBash.mock.calls[0]?.[0]?.command).toContain('pnpm run lint');
    expect(mocks.runBash.mock.calls[1]?.[0]?.command).toContain('pnpm type-check');
    expect(mocks.runBash.mock.calls[2]?.[0]?.command).toContain('pnpm test');
  });

  it('keeps skip behavior when there are no observed changes', async () => {
    mocks.detectObservedChangedFiles.mockResolvedValue([]);

    const out = await verifyNode(baseState() as any);

    expect(out.phase).toBe('reviewing');
    expect(out.fileEdits).toEqual([]);
    expect(out.verificationResult?.passed).toBe(true);
    expect(out.verificationResult?.typecheck_output).toContain('Skipped verification');
    expect(out.verificationResult?.newErrorCount).toBe(0);
    expect(mocks.runBash).not.toHaveBeenCalled();
  });

  it('runs lightweight mid-step typecheck and bails on >10 new errors', async () => {
    const errorLines = Array.from({ length: 15 }, (_, i) =>
      `src/file${i}.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.`,
    ).join('\n');
    mocks.runBash.mockResolvedValue({
      success: false,
      exit_code: 1,
      stdout: errorLines,
      stderr: '',
    });
    // Provide a clean baseline so mid-step check can distinguish new vs pre-existing errors
    mocks.getBaselineFingerprint.mockResolvedValue({ hash: 'abc', errorLines: [] });

    const state = {
      ...baseState(),
      steps: [
        { index: 0, description: 'step1', files: ['/repo/a.ts'], status: 'done' },
        { index: 1, description: 'step2', files: ['/repo/b.ts'], status: 'pending' },
      ],
      currentStepIndex: 0,
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1 as const, old_string: 'a', new_string: 'b', timestamp: 1 }],
    };

    const out = await verifyNode(state as any);

    expect(out.phase).toBe('reviewing');
    expect(out.verificationResult?.passed).toBe(false);
    expect(out.verificationResult?.newErrorCount).toBe(15);
    expect(out.verificationResult?.typecheck_output).toContain('Mid-step check');
    expect((out as any).executionIssue?.recoverable).toBe(true);
    expect((out as any).executionIssue?.message).toContain('Mid-step typecheck');
    // Should only run the lightweight check, not the full verify
    expect(mocks.runBash).toHaveBeenCalledTimes(1);
    expect(mocks.runBash.mock.calls[0]?.[0]?.command).toContain('pnpm type-check');
  });

  it('passes mid-step lightweight check when errors are below threshold', async () => {
    const fewErrors = Array.from({ length: 3 }, (_, i) =>
      `src/file${i}.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.`,
    ).join('\n');
    // First call: lightweight tsc (few errors, below threshold)
    // Remaining calls: full lint + typecheck (both pass)
    mocks.runBash
      .mockResolvedValueOnce({ success: false, exit_code: 1, stdout: fewErrors, stderr: '' })
      .mockResolvedValue({ success: true, exit_code: 0, stdout: '', stderr: '' });
    // Provide a clean baseline so mid-step check runs
    mocks.getBaselineFingerprint.mockResolvedValue({ hash: 'abc', errorLines: [] });

    const state = {
      ...baseState(),
      steps: [
        { index: 0, description: 'step1', files: ['/repo/a.ts'], status: 'done' },
        { index: 1, description: 'step2', files: ['/repo/b.ts'], status: 'pending' },
      ],
      currentStepIndex: 0,
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1 as const, old_string: 'a', new_string: 'b', timestamp: 1 }],
    };

    const out = await verifyNode(state as any);

    expect(out.phase).toBe('reviewing');
    // Lightweight check passed (below threshold), so full verify runs
    expect(mocks.runBash).toHaveBeenCalledTimes(3); // lightweight + lint + typecheck (no test for mid-step)
    expect(mocks.runBash.mock.calls[0]?.[0]?.command).toContain('pnpm type-check');
    expect(mocks.runBash.mock.calls[1]?.[0]?.command).toContain('pnpm run lint');
  });

  it('short-circuits when executionIssue is recoverable', async () => {
    const state = {
      ...baseState(),
      executionIssue: {
        kind: 'guardrail' as const,
        recoverable: true,
        message: 'Scope violation',
        nextAction: 'Retry',
        stopReason: 'guardrail_violation' as const,
      },
    };

    const out = await verifyNode(state as any);

    expect(out.phase).toBe('reviewing');
    expect(out.verificationResult?.passed).toBe(false);
    expect(out.verificationResult?.newErrorCount).toBe(0);
    expect(out.verificationResult?.typecheck_output).toContain('Skipped verification');
    expect(mocks.runBash).not.toHaveBeenCalled();
  });

  it('can force test execution on non-final steps', async () => {
    mocks.runBash.mockResolvedValue({
      success: true,
      exit_code: 0,
      stdout: '',
      stderr: '',
    });

    const state = {
      ...baseState(),
      steps: [
        { index: 0, description: 'step1', files: ['/repo/a.ts'], status: 'pending' },
        { index: 1, description: 'step2', files: ['/repo/b.ts'], status: 'pending' },
      ],
      currentStepIndex: 0,
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1 as const, old_string: 'a', new_string: 'b', timestamp: 1 }],
    };

    const out = await runVerification(state as any, { runTests: 'always' });

    expect(out.verificationResult?.passed).toBe(true);
    expect(mocks.runBash).toHaveBeenCalledTimes(3);
    expect(mocks.runBash.mock.calls[2]?.[0]?.command).toContain('pnpm test');
  });
});
