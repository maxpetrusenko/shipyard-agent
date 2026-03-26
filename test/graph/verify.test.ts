import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runBash: vi.fn(),
  getRunAbortSignal: vi.fn(),
  detectObservedChangedFiles: vi.fn(),
}));

vi.mock('../../src/tools/bash.js', () => ({
  runBash: mocks.runBash,
}));

vi.mock('../../src/runtime/run-signal.js', () => ({
  getRunAbortSignal: mocks.getRunAbortSignal,
}));

vi.mock('../../src/runtime/run-baselines.js', () => ({
  detectObservedChangedFiles: mocks.detectObservedChangedFiles,
}));

import { verifyNode } from '../../src/graph/nodes/verify.js';

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
  } as const;
}

describe('verifyNode', () => {
  beforeEach(() => {
    mocks.runBash.mockReset();
    mocks.getRunAbortSignal.mockReset();
    mocks.detectObservedChangedFiles.mockReset();
    mocks.getRunAbortSignal.mockReturnValue(null);
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
    expect(mocks.runBash).not.toHaveBeenCalled();
  });
});
