import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runWorker: vi.fn(),
  runVerification: vi.fn(),
}));

vi.mock('../../src/multi-agent/worker.js', () => ({
  runWorker: mocks.runWorker,
}));

vi.mock('../../src/graph/nodes/verify.js', () => ({
  runVerification: mocks.runVerification,
}));

import { coordinateNode } from '../../src/graph/nodes/coordinate.js';
import type { ShipyardStateType } from '../../src/graph/state.js';

function edit(file_path: string, timestamp: number) {
  return {
    file_path,
    tier: 1 as const,
    old_string: 'before',
    new_string: 'after',
    timestamp,
  };
}

function verificationResult(passed: boolean, errorCount = 0) {
  return {
    passed,
    error_count: errorCount,
    newErrorCount: errorCount,
    typecheck_output: passed ? '' : 'typecheck failed',
    test_output: passed ? '' : 'test failed',
  };
}

function baseState(): ShipyardStateType {
  return {
    runId: 'run',
    traceId: 'trace',
    instruction: 'full refactor',
    phase: 'planning',
    steps: [
      { index: 0, description: 'refactor api', files: ['/repo/api.ts'], status: 'pending' },
      { index: 1, description: 'refactor web', files: ['/repo/web.ts'], status: 'pending' },
    ],
    currentStepIndex: 0,
    currentStepEditBaseline: null,
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
    executionIssue: null,
    tokenUsage: null,
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    forceSequential: false,
    loopDiagnostics: null,
    executeDiagnostics: null,
    modelHint: 'opus',
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
  };
}

describe('coordinateNode worker orchestration', () => {
  beforeEach(() => {
    mocks.runWorker.mockReset();
    mocks.runVerification.mockReset();
  });

  it('runs step workers sequentially, repairs failing verification, then continues', async () => {
    mocks.runWorker
      .mockResolvedValueOnce({
        subtaskId: 'step-1-implement-1',
        phase: 'done',
        fileEdits: [edit('/repo/api.ts', 1)],
        fileOverlaySnapshots: JSON.stringify({ '/repo/api.ts': 'orig-api' }),
        toolCallHistory: [],
        tokenUsage: { input: 10, output: 5 },
        error: null,
        durationMs: 10,
      })
      .mockResolvedValueOnce({
        subtaskId: 'step-1-repair-2',
        phase: 'done',
        fileEdits: [edit('/repo/api.ts', 2)],
        fileOverlaySnapshots: JSON.stringify({ '/repo/api.ts': 'mid-api' }),
        toolCallHistory: [],
        tokenUsage: { input: 3, output: 2 },
        error: null,
        durationMs: 8,
      })
      .mockResolvedValueOnce({
        subtaskId: 'step-2-implement-1',
        phase: 'done',
        fileEdits: [edit('/repo/web.ts', 3)],
        fileOverlaySnapshots: JSON.stringify({ '/repo/web.ts': 'orig-web' }),
        toolCallHistory: [],
        tokenUsage: { input: 4, output: 1 },
        error: null,
        durationMs: 6,
      });

    mocks.runVerification
      .mockResolvedValueOnce({ verificationResult: verificationResult(false, 2) })
      .mockResolvedValueOnce({ verificationResult: verificationResult(true) })
      .mockResolvedValueOnce({ verificationResult: verificationResult(true) });

    const out = await coordinateNode(baseState());

    expect(mocks.runWorker).toHaveBeenCalledTimes(3);
    expect(mocks.runVerification).toHaveBeenCalledTimes(3);
    expect(out.phase).toBe('verifying');
    expect(out.executionIssue).toBeNull();
    expect(out.steps?.every((step) => step.status === 'done')).toBe(true);
    expect(out.fileEdits).toHaveLength(3);
    expect(out.workerResults).toHaveLength(3);
    expect(out.fileOverlaySnapshots).toContain('orig-api');
    expect(out.fileOverlaySnapshots).not.toContain('mid-api');
    expect(out.fileOverlaySnapshots).toContain('orig-web');
  });

  it('returns recoverable coordination issue when a worker errors', async () => {
    mocks.runWorker.mockResolvedValueOnce({
      subtaskId: 'step-1-implement-1',
      phase: 'error',
      fileEdits: [edit('/repo/api.ts', 1)],
      fileOverlaySnapshots: JSON.stringify({ '/repo/api.ts': 'orig-api' }),
      toolCallHistory: [],
      tokenUsage: { input: 2, output: 1 },
      error: 'worker crashed',
      durationMs: 5,
    });

    const out = await coordinateNode(baseState());

    expect(mocks.runVerification).not.toHaveBeenCalled();
    expect(out.executionIssue?.kind).toBe('coordination');
    expect(out.executionIssue?.recoverable).toBe(true);
    expect(out.steps?.[0]?.status).toBe('failed');
    expect(out.fileOverlaySnapshots).toContain('orig-api');
  });

  it('falls through to execute when forceSequential is set', async () => {
    const out = await coordinateNode({ ...baseState(), forceSequential: true });

    expect(mocks.runWorker).not.toHaveBeenCalled();
    expect(out.phase).toBe('executing');
    expect(out.workerResults).toEqual([]);
  });
});
