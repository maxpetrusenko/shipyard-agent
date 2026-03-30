import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  commitAndOpenPrMock,
  hasSuccessfulPrToolCallMock,
} = vi.hoisted(() => ({
  commitAndOpenPrMock: vi.fn(),
  hasSuccessfulPrToolCallMock: vi.fn(),
}));

vi.mock('../../src/tools/commit-and-open-pr.js', () => ({
  commitAndOpenPr: commitAndOpenPrMock,
  hasSuccessfulPrToolCall: hasSuccessfulPrToolCallMock,
}));

import { reportNode } from '../../src/graph/nodes/report.js';

function baseState() {
  return {
    runId: 'run-123',
    traceId: 'trace-1',
    instruction: 'Update API route',
    phase: 'reviewing',
    steps: [{ index: 0, description: 'x', files: [], status: 'done' }],
    currentStepIndex: 0,
    fileEdits: [
      {
        file_path: '/tmp/a.ts',
        tier: 1,
        old_string: 'a',
        new_string: 'b',
        timestamp: Date.now(),
      },
    ],
    toolCallHistory: [],
    verificationResult: { passed: true, error_count: 0 },
    reviewDecision: 'done',
    reviewFeedback: null,
    contexts: [],
    messages: [],
    error: null,
    retryCount: 0,
    maxRetries: 3,
    tokenUsage: { input: 1, output: 2 },
    traceUrl: null,
    runStartedAt: Date.now() - 1000,
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

describe('reportNode PR fallback', () => {
  beforeEach(() => {
    commitAndOpenPrMock.mockReset();
    hasSuccessfulPrToolCallMock.mockReset();
  });

  it('does not auto-create PR when the user did not request commit or PR behavior', async () => {
    hasSuccessfulPrToolCallMock.mockReturnValue(false);

    const out = await reportNode(baseState() as any);
    expect(commitAndOpenPrMock).not.toHaveBeenCalled();
    const last = out.messages?.at(-1)?.content ?? '';
    expect(last).not.toContain('PR:');
  });

  it('does not auto-create PR if commit_and_open_pr already succeeded', async () => {
    hasSuccessfulPrToolCallMock.mockReturnValue(true);
    const out = await reportNode(baseState() as any);
    expect(commitAndOpenPrMock).not.toHaveBeenCalled();
    const last = out.messages?.at(-1)?.content ?? '';
    expect(last).toContain('PR: created during execute step');
  });

  it('preserves fatal runs as error instead of marking them done', async () => {
    hasSuccessfulPrToolCallMock.mockReturnValue(false);

    const out = await reportNode({
      ...baseState(),
      phase: 'error',
      reviewDecision: 'escalate',
      reviewFeedback: 'Explicit target missing after repository search.',
      error: 'Fatal: max retries (3) exhausted. Last error: explicit target missing.',
    } as any);

    expect(out.phase).toBe('error');
    const last = out.messages?.at(-1)?.content ?? '';
    expect(last).toContain('Outcome: FAILED');
    expect(last).toContain('Fatal: max retries');
  });

  it('labels passed verification with pre-existing errors clearly', async () => {
    hasSuccessfulPrToolCallMock.mockReturnValue(false);

    const out = await reportNode({
      ...baseState(),
      verificationResult: {
        passed: true,
        error_count: 1,
        newErrorCount: 0,
        preExistingErrorCount: 1,
      },
    } as any);

    const last = out.messages?.at(-1)?.content ?? '';
    expect(last).toContain('Verification: PASSED (0 new, 1 pre-existing)');
    expect(last).toContain('Errors: 1');
  });
});
