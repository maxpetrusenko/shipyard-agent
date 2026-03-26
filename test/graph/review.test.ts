import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeTextForRole: vi.fn(),
}));

vi.mock('../../src/llm/complete-text.js', () => ({
  completeTextForRole: mocks.completeTextForRole,
}));

import { reviewNode } from '../../src/graph/nodes/review.js';

function baseState() {
  return {
    runId: 'run-review',
    traceId: 'trace-review',
    instruction: 'make exactly one file change',
    phase: 'reviewing',
    steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' }],
    currentStepIndex: 0,
    fileEdits: [],
    toolCallHistory: [],
    verificationResult: { passed: true, error_count: 0 },
    reviewDecision: null,
    reviewFeedback: null,
    contexts: [],
    messages: [],
    error: null,
    retryCount: 0,
    maxRetries: 3,
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    modelHint: null,
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: 'gpt-5-mini',
    modelFamily: 'openai',
    modelOverrides: null,
  } as const;
}

describe('reviewNode deterministic guards', () => {
  beforeEach(() => {
    mocks.completeTextForRole.mockReset();
  });

  it('retries when strict single-file instruction has zero edits', async () => {
    const out = await reviewNode(baseState() as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('exactly one file');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('retries when failed steps exist', async () => {
    const state = {
      ...baseState(),
      instruction: 'update parser implementation',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'failed' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('failed step');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('finishes explicit single-target tasks once the target file is validated, even if extra plan steps remain', async () => {
    const state = {
      ...baseState(),
      instruction: 'Update /repo/CONTRIBUTING.md to say Hello world.',
      steps: [
        { index: 0, description: 'edit target', files: ['/repo/CONTRIBUTING.md'], status: 'done' as const },
        { index: 1, description: 'wander elsewhere', files: ['/repo/other.ts'], status: 'pending' as const },
      ],
      fileEdits: [
        {
          file_path: '/repo/CONTRIBUTING.md',
          tier: 1,
          old_string: 'Hello',
          new_string: 'Hello world',
          timestamp: 1,
        },
      ],
    };

    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('done');
    expect(out.phase).toBe('done');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('treats explicit single-target already-satisfied requests as done no-ops', async () => {
    const state = {
      ...baseState(),
      instruction: 'Update /repo/CONTRIBUTING.md to include "Hello world".',
      fileEdits: [],
      verificationResult: {
        passed: true,
        error_count: 0,
        typecheck_output: 'Skipped verification (no file edits in run).',
      },
      messages: [
        { role: 'assistant', content: 'No changes needed: /repo/CONTRIBUTING.md already contains "Hello world".' },
      ],
    };

    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('done');
    expect(out.phase).toBe('done');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });
});
