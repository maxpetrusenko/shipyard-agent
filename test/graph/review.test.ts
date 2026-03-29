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

  it('offloads watchdog stalls instead of burning more retries', async () => {
    const state = {
      ...baseState(),
      instruction: 'update comments schema',
      steps: [{ index: 0, description: 'x', files: ['/repo/comments.ts'], status: 'failed' as const }],
      executionIssue: {
        kind: 'watchdog' as const,
        recoverable: true,
        message:
          'Watchdog: repeated identical tool call loop detected (read_file ×4 on /repo/comments.ts).',
        nextAction: 'Retry',
        stopReason: 'stalled_no_edit_rounds' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('escalate');
    expect(out.reviewFeedback).toContain('Offloading instead of burning more retries');
    expect(out.reviewFeedback).toContain('repeated identical tool call loop');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('retries retryable watchdog stalls instead of offloading the run', async () => {
    const state = {
      ...baseState(),
      instruction: 'harden auth middleware',
      steps: [{ index: 0, description: 'x', files: ['/repo/auth.ts'], status: 'failed' as const }],
      executionIssue: {
        kind: 'watchdog' as const,
        recoverable: true,
        message:
          'Watchdog: execution stalled. Blocker: edit_file: old_string matched 2 times. Provide more surrounding context to make it unique.',
        nextAction:
          'Your last edit_file call failed because old_string matched multiple places. Re-read the file and include more surrounding context so the replacement is unique. Do not retry the same old_string again.',
        stopReason: 'stalled_no_edit_rounds' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.phase).toBe('executing');
    expect(out.reviewFeedback).toContain('old_string matched 2 times');
    expect(out.reviewFeedback).toContain('Root cause guidance');
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

  it('replans once, then offloads cascade failures above 50 new errors', async () => {
    const retryOut = await reviewNode({
      ...baseState(),
      maxRetries: 8,
      retryCount: 0,
      instruction: 'repair integrated target',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 61,
        newErrorCount: 61,
        preExistingErrorCount: 0,
      },
    } as any);

    expect(retryOut.reviewDecision).toBe('retry');
    expect(retryOut.phase).toBe('planning');
    expect(retryOut.reviewFeedback).toContain('cascade');

    const escalateOut = await reviewNode({
      ...baseState(),
      maxRetries: 8,
      retryCount: 1,
      instruction: 'repair integrated target',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 61,
        newErrorCount: 61,
        preExistingErrorCount: 0,
      },
    } as any);

    expect(escalateOut.reviewDecision).toBe('escalate');
    expect(escalateOut.phase).toBe('error');
    expect(escalateOut.reviewFeedback).toContain('Offloading instead of looping');
  });

  it('offloads small verification failures after three repair attempts', async () => {
    const out = await reviewNode({
      ...baseState(),
      maxRetries: 8,
      retryCount: 3,
      instruction: 'repair integrated target',
      steps: [{ index: 0, description: 'x', files: ['/repo/a.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 5,
        newErrorCount: 5,
        preExistingErrorCount: 0,
      },
    } as any);

    expect(out.reviewDecision).toBe('escalate');
    expect(out.phase).toBe('error');
    expect(out.reviewFeedback).toContain('consuming the remaining retry budget');
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

  it('includes typecheck output in retry feedback so executor knows what to fix', async () => {
    const typecheckOutput = "src/middleware/auth-v2.ts(155,7): error TS2322: Type 'string | string[]' is not assignable to type 'string | null | undefined'.";
    const state = {
      ...baseState(),
      instruction: 'implement auth middleware',
      steps: [{ index: 0, description: 'x', files: ['/repo/auth.ts'], status: 'done' as const }],
      fileEdits: [{ file_path: '/repo/auth.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      verificationResult: {
        passed: false,
        error_count: 3,
        newErrorCount: 3,
        preExistingErrorCount: 0,
        typecheck_output: typecheckOutput,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.reviewFeedback).toContain('auth-v2.ts(155,7)');
    expect(out.reviewFeedback).toContain('TS2322');
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

  it('treats evidence-rich past-tense no-op replies as done for conditional multi-file steps', async () => {
    const state = {
      ...baseState(),
      instruction: 'Implement the auth/session stack, but only change shared constants if required.',
      steps: [
        {
          index: 0,
          description:
            'Confirm shared auth constants and only modify them if any required values are missing.',
          files: ['/repo/shared/src/constants.ts', '/repo/shared/src/index.ts'],
          status: 'done' as const,
        },
        {
          index: 1,
          description: 'Update auth middleware internals.',
          files: ['/repo/api/src/middleware/auth.ts'],
          status: 'pending' as const,
        },
      ],
      currentStepIndex: 0,
      fileEdits: [],
      verificationResult: {
        passed: true,
        error_count: 0,
        newErrorCount: 0,
        preExistingErrorCount: 0,
      },
      messages: [
        {
          role: 'assistant',
          content:
            'Reviewed the shared auth/session-facing exports. No changes were needed because /repo/shared/src/constants.ts already defines the required timeout constants and error codes.\n\nSTEP_COMPLETE',
        },
      ],
    };

    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('continue');
    expect(out.phase).toBe('executing');
    expect(out.currentStepIndex).toBe(1);
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

  it('retries retryable watchdog using blockerCode (ambiguous_edit)', async () => {
    const state = {
      ...baseState(),
      instruction: 'harden auth middleware',
      steps: [{ index: 0, description: 'x', files: ['/repo/auth.ts'], status: 'failed' as const }],
      fileEdits: [{ file_path: '/repo/auth.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      executionIssue: {
        kind: 'watchdog' as const,
        recoverable: true,
        message: 'Watchdog: execution stalled.',
        nextAction: 'Retry with more context.',
        stopReason: 'stalled_no_edit_rounds' as const,
        blockerCode: 'ambiguous_edit' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.phase).toBe('executing');
    expect(out.executionIssue).toBeNull();
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('escalates terminal watchdog with blockerCode (repeated_tool_loop)', async () => {
    const state = {
      ...baseState(),
      instruction: 'update comments schema',
      steps: [{ index: 0, description: 'x', files: ['/repo/comments.ts'], status: 'failed' as const }],
      executionIssue: {
        kind: 'watchdog' as const,
        recoverable: true,
        message: 'Watchdog: repeated identical tool call loop detected.',
        nextAction: 'Switch strategy.',
        stopReason: 'stalled_no_edit_rounds' as const,
        blockerCode: 'repeated_tool_loop' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('escalate');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('retries retryable watchdog using blockerCode (identical_noop)', async () => {
    const state = {
      ...baseState(),
      instruction: 'update middleware',
      steps: [{ index: 0, description: 'x', files: ['/repo/mid.ts'], status: 'failed' as const }],
      fileEdits: [{ file_path: '/repo/mid.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
      executionIssue: {
        kind: 'watchdog' as const,
        recoverable: true,
        message: 'Watchdog: execution stalled.',
        nextAction: 'Retry.',
        stopReason: 'stalled_no_edit_rounds' as const,
        blockerCode: 'identical_noop' as const,
      },
    };
    const out = await reviewNode(state as any);
    expect(out.reviewDecision).toBe('retry');
    expect(out.phase).toBe('executing');
  });
});
