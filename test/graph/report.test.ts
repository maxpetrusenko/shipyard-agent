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
});
