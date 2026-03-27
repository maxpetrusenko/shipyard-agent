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
    executionIssue: null,
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

  it('retries when executionIssue is recoverable', async () => {
    const state = {
      ...baseState(),
      instruction: 'update parser implementation',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'failed' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      executionIssue: {
        kind: 'guardrail' as const,
        recoverable: true,
        message: 'Scope violation',
        nextAction: 'Retry',
        stopReason: 'guardrail_violation' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('guardrail');
    expect(out.executionIssue).toBeNull();
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('escalates instead of retrying when newErrorCount > 80', async () => {
    const state = {
      ...baseState(),
      instruction: 'update parser implementation',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 121,
        newErrorCount: 121,
        preExistingErrorCount: 0,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('escalate');
    expect(out.phase).toBe('error');
    expect(out.reviewFeedback).toContain('Too many errors (121)');
    expect(out.reviewFeedback).toContain('Escalating instead of retrying');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('retries (not escalates) when newErrorCount is 44 (cascade inflation)', async () => {
    // Regression: step 09 rebuild had 44 "new errors" but root cause was 1 bad migration
    // + 5 TS errors. A single DB setup failure cascaded across 61 test suites.
    const state = {
      ...baseState(),
      instruction: 'Implement file uploads and comments',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 67,
        newErrorCount: 44,
        preExistingErrorCount: 23,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('44 new error');
    expect(out.phase).not.toBe('error');
  });

  it('retries normally when newErrorCount is between 1-80', async () => {
    const state = {
      ...baseState(),
      instruction: 'update parser implementation',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 5,
        newErrorCount: 5,
        preExistingErrorCount: 0,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('5 new error');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('retries to executing (not planning) when verification fails with existing steps', async () => {
    // Regression: step 09 wasted retries re-planning when only 2 syntax errors needed fixing
    const state = {
      ...baseState(),
      instruction: 'Implement file uploads',
      steps: [
        { index: 0, description: 'Create routes/files.ts', files: ['/repo/routes/files.ts'], status: 'done' as const },
        { index: 1, description: 'Create frontend hooks', files: ['/repo/src/hooks/useCommentsQuery.ts'], status: 'done' as const },
      ],
      fileEdits: [{ file_path: '/repo/routes/files.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 2,
        newErrorCount: 2,
        preExistingErrorCount: 0,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.phase).toBe('executing');
    expect(out.retryCount).toBe(1);
  });

  it('retries when newErrorCount > 0', async () => {
    const state = {
      ...baseState(),
      instruction: 'update parser implementation',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 3,
        newErrorCount: 2,
        preExistingErrorCount: 1,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('2 new error');
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

  it('deterministically completes when verification passed with 0 new errors and pre-existing errors', async () => {
    // Regression: run 897503b1 — LLM confused by "Passed: true but Errors: 24"
    // when all 24 were pre-existing. Deterministic guard should short-circuit.
    const state = {
      ...baseState(),
      instruction: 'Implement file uploads and comments with backlinks',
      steps: [
        { index: 0, description: 'Create upload routes', files: ['/repo/routes/uploads.ts'], status: 'done' as const },
        { index: 1, description: 'Create comment hooks', files: ['/repo/src/hooks/useComments.ts'], status: 'done' as const },
      ],
      currentStepIndex: 1,
      fileEdits: [
        { file_path: '/repo/routes/uploads.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 },
        { file_path: '/repo/src/hooks/useComments.ts', tier: 1, old_string: 'c', new_string: 'd', timestamp: 2 },
      ],
      verificationResult: {
        passed: true,
        error_count: 24,
        newErrorCount: 0,
        preExistingErrorCount: 24,
      },
    };

    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('done');
    expect(out.phase).toBe('done');
    expect(out.reviewFeedback).toContain('0 new errors');
    expect(out.reviewFeedback).toContain('pre-existing');
    // Must NOT call LLM — deterministic fast-path
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('escalates explicit single-target tasks when the target file is reported missing', async () => {
    const state = {
      ...baseState(),
      instruction: 'Update /repo/src/server/run-debug.ts to include "Hello world".',
      verificationResult: {
        passed: true,
        error_count: 0,
        typecheck_output: 'Skipped verification (no file edits in run).',
      },
      messages: [
        {
          role: 'assistant',
          content:
            'I could not complete this because /repo/src/server/run-debug.ts does not exist in the repository and there were no matches for run-debug.',
        },
      ],
    };

    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('escalate');
    expect(out.phase).toBe('error');
    expect(out.reviewFeedback).toContain('/repo/src/server/run-debug.ts');
    expect(out.error).toContain('missing after repository search');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });
});
