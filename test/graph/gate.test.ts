import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeTextForRole: vi.fn(),
  classifyIntentLlm: vi.fn(),
  extractCacheMetrics: vi.fn(),
  getClient: vi.fn(() => ({})),
  looksLikeCodeRequest: vi.fn(),
  messagesCreate: vi.fn(),
  tryArithmeticShortcut: vi.fn(),
  tryChatShortcut: vi.fn(),
  tryCommandShortcut: vi.fn(),
}));

vi.mock('../../src/config/client.js', () => ({
  CACHE_CONTROL: { type: 'ephemeral' },
  getClient: mocks.getClient,
  wrapSystemPrompt: (prompt: string) => prompt,
}));

vi.mock('../../src/config/messages-create.js', () => ({
  extractCacheMetrics: mocks.extractCacheMetrics,
  messagesCreate: mocks.messagesCreate,
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
    mocks.extractCacheMetrics.mockReset();
    mocks.getClient.mockReset();
    mocks.looksLikeCodeRequest.mockReset();
    mocks.messagesCreate.mockReset();
    mocks.tryArithmeticShortcut.mockReset();
    mocks.tryChatShortcut.mockReset();
    mocks.tryCommandShortcut.mockReset();
    mocks.getClient.mockReturnValue({});
    mocks.extractCacheMetrics.mockReturnValue({ cacheRead: 0, cacheCreation: 0 });
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
      executionIssue: null,
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
      executionIssue: null,
    });

    expect(result.phase).toBe('done');
    expect(result.gateRoute).toBe('end');
    expect(result.messages?.at(-1)?.content).toBe('Direct answer');
    expect(mocks.completeTextForRole).toHaveBeenCalledTimes(1);
    expect(mocks.classifyIntentLlm).not.toHaveBeenCalled();
  });

  it('compacts oversized openai chat history before completion', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.completeTextForRole.mockResolvedValue({
      text: 'Direct answer',
      inputTokens: 11,
      outputTokens: 7,
      cacheRead: 0,
      cacheCreation: 0,
    });

    const large = 'x'.repeat(12_000);
    const messages = Array.from({ length: 10 }, (_value, index) => ([
      { role: 'user' as const, content: `question ${index} ${large}` },
      { role: 'assistant' as const, content: `answer ${index} ${large}` },
    ])).flat();

    const result = await gateNode({
      runId: 'run-chat-openai-compact',
      traceId: 'trace-chat-openai-compact',
      instruction: 'latest follow-up',
      phase: 'routing',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      contexts: [],
      messages,
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
      runMode: 'chat',
      gateRoute: 'plan',
      modelOverride: 'gpt-5-mini',
      modelFamily: 'openai',
      modelOverrides: null,
      executionIssue: null,
    });

    expect(mocks.completeTextForRole).toHaveBeenCalledTimes(1);
    const history = mocks.completeTextForRole.mock.calls[0]?.[3] as Array<{ role: string; content: string }>;
    expect(history.length).toBeLessThan(messages.length + 1);
    expect(history.some((message) =>
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.includes('Compacted conversation context')
    )).toBe(true);
    expect(result.messages?.some((message) =>
      message.role === 'assistant' && message.content.includes('[Compaction] chat history compacted')
    )).toBe(true);
  });

  it('compacts oversized anthropic chat history before messages.create', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Anthropic answer' }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const large = 'y'.repeat(12_000);
    const messages = Array.from({ length: 10 }, (_value, index) => ([
      { role: 'user' as const, content: `question ${index} ${large}` },
      { role: 'assistant' as const, content: `answer ${index} ${large}` },
    ])).flat();

    const result = await gateNode({
      runId: 'run-chat-anthropic-compact',
      traceId: 'trace-chat-anthropic-compact',
      instruction: 'latest follow-up',
      phase: 'routing',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      contexts: [],
      messages,
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
      runMode: 'chat',
      gateRoute: 'plan',
      modelOverride: null,
      modelFamily: 'anthropic',
      modelOverrides: null,
      executionIssue: null,
    });

    expect(mocks.messagesCreate).toHaveBeenCalledTimes(1);
    const request = mocks.messagesCreate.mock.calls[0]?.[1] as { messages: Array<{ role: string; content: unknown }> };
    expect(request.messages.length).toBeLessThan(messages.length + 1);
    expect(request.messages.some((message) =>
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.includes('Compacted conversation context')
    )).toBe(true);
    expect(result.messages?.some((message) =>
      message.role === 'assistant' && message.content.includes('[Compaction] chat history compacted')
    )).toBe(true);
  });

  it('fails fast when instruction repo target mismatches active workdir', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.looksLikeCodeRequest.mockReturnValue(true);

    const result = await gateNode({
      runId: 'run-repo-mismatch',
      traceId: 'trace-repo-mismatch',
      instruction: 'In ship-refactored, make exactly one bugfix.',
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
      executionIssue: null,
    });

    expect(result.phase).toBe('error');
    expect(result.gateRoute).toBe('end');
    expect(result.error).toContain('Repo target mismatch');
    expect(result.error).toContain('ship-refactored');
    expect(result.error).toContain('ship-agent');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('uses supplied execution plans without calling the planner path', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.looksLikeCodeRequest.mockReturnValue(true);

    const result = await gateNode({
      runId: 'run-planless',
      traceId: 'trace-planless',
      instruction: 'execute provided refactor plan',
      phase: 'planning',
      steps: [
        { index: 0, description: 'refactor api', files: ['/repo/api.ts'], status: 'pending' },
        { index: 1, description: 'refactor web', files: ['/repo/web.ts'], status: 'pending' },
      ],
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
    });

    expect(result.phase).toBe('executing');
    expect(result.gateRoute).toBe('coordinate');
    expect(result.steps).toHaveLength(2);
    expect(result.messages?.at(-1)?.content).toContain('Using supplied execution plan');
    expect(mocks.completeTextForRole).not.toHaveBeenCalled();
  });

  it('rejects malformed supplied execution plans before execution', async () => {
    mocks.tryCommandShortcut.mockResolvedValue(null);
    mocks.tryArithmeticShortcut.mockReturnValue(null);
    mocks.tryChatShortcut.mockReturnValue(null);
    mocks.looksLikeCodeRequest.mockReturnValue(true);

    const result = await gateNode({
      runId: 'run-bad-plan',
      traceId: 'trace-bad-plan',
      instruction: 'execute provided refactor plan',
      phase: 'planning',
      steps: [
        { index: 0, description: '   ', files: ['/repo/api.ts'], status: 'pending' },
      ],
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
    });

    expect(result.phase).toBe('error');
    expect(result.gateRoute).toBe('end');
    expect(result.error).toContain('missing a description');
  });
});
