import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeTextForRole: vi.fn(),
  classifyIntentLlm: vi.fn(),
  looksLikeCodeRequest: vi.fn(),
  tryArithmeticShortcut: vi.fn(),
  tryChatShortcut: vi.fn(),
  tryCommandShortcut: vi.fn(),
}));

vi.mock('../../src/llm/complete-text.js', () => ({
  completeTextForRole: mocks.completeTextForRole,
}));

vi.mock('../../src/graph/intent.js', () => ({
  classifyIntentLlm: mocks.classifyIntentLlm,
  looksLikeCodeRequest: mocks.looksLikeCodeRequest,
  tryArithmeticShortcut: mocks.tryArithmeticShortcut,
  tryChatShortcut: mocks.tryChatShortcut,
}));

vi.mock('../../src/graph/commands.js', () => ({
  tryCommandShortcut: mocks.tryCommandShortcut,
}));

import { gateNode } from '../../src/graph/nodes/gate.js';

describe('gateNode', () => {
  beforeEach(() => {
    mocks.completeTextForRole.mockReset();
    mocks.classifyIntentLlm.mockReset();
    mocks.looksLikeCodeRequest.mockReset();
    mocks.tryArithmeticShortcut.mockReset();
    mocks.tryChatShortcut.mockReset();
    mocks.tryCommandShortcut.mockReset();
  });

  it('executes command shortcuts before other routing logic', async () => {
    mocks.tryCommandShortcut.mockResolvedValue('tool list');
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.looksLikeCodeRequest.mockReturnValue(true);

    const result = await gateNode({
      runId: 'run-cmd',
      traceId: 'trace-cmd',
      instruction: '/tools',
      phase: 'routing',
      steps: [],
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
      runMode: 'auto',
      gateRoute: 'plan',
      modelOverride: 'gpt-5-mini',
      modelFamily: 'openai',
      modelOverrides: null,
    });

    expect(result.phase).toBe('done');
    expect(result.gateRoute).toBe('end');
    expect(result.messages?.at(-1)?.content).toBe('tool list');
    expect(mocks.tryCommandShortcut).toHaveBeenCalledTimes(1);
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('replies directly for normal auto asks without classifier round-trip', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.looksLikeCodeRequest.mockReturnValue(false);
    mocks.completeTextForRole.mockResolvedValue({
      text: 'Direct answer',
      inputTokens: 11,
      outputTokens: 7,
      cacheRead: 0,
      cacheCreation: 0,
    });
    mocks.classifyIntentLlm.mockResolvedValue({
      intent: 'code',
      inputTokens: 99,
      outputTokens: 99,
    });

    const result = await gateNode({
      runId: 'run-1',
      traceId: 'trace-1',
      instruction: 'test',
      phase: 'routing',
      steps: [],
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
      runMode: 'auto',
      gateRoute: 'plan',
      modelOverride: 'gpt-5-mini',
      modelFamily: 'openai',
      modelOverrides: null,
    });

    expect(result.phase).toBe('done');
    expect(result.gateRoute).toBe('end');
    expect(result.messages?.at(-1)?.content).toBe('Direct answer');
    expect(mocks.completeTextForRole).toHaveBeenCalledTimes(1);
    expect(mocks.classifyIntentLlm).not.toHaveBeenCalled();
  });
});
