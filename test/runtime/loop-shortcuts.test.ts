import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let releaseGraph: (() => void) | null = null;
let streamedStates: Array<Record<string, unknown>> = [];

vi.mock('../../src/graph/builder.js', () => ({
  createShipyardGraph: () => ({
    stream: async (state: Record<string, unknown>) => ({
      async *[Symbol.asyncIterator]() {
        streamedStates.push(state);
        await new Promise<void>((resolve) => {
          releaseGraph = resolve;
        });
        const priorMessages =
          ((state.messages as Array<{ role: string; content: string }> | undefined) ?? []);
        const currentInstruction = String(state.instruction ?? '');
        const lastUser = [...priorMessages].reverse().find((msg) => msg.role === 'user');
        const withCurrentUser =
          lastUser && lastUser.content === currentInstruction
            ? priorMessages
            : [...priorMessages, { role: 'user', content: currentInstruction }];
        yield {
          report: {
            ...state,
            phase: 'done',
            steps: [],
            fileEdits: [],
            toolCallHistory: [],
            tokenUsage: { input: 1, output: 1 },
            traceUrl: null,
            messages: [
              ...withCurrentUser,
              { role: 'assistant', content: `Done: ${currentInstruction}` },
            ],
            error: null,
          },
        };
      },
    }),
  }),
}));

vi.mock('../../src/runtime/langsmith.js', () => ({
  isTracingEnabled: () => false,
  canTrace: () => false,
  buildTraceUrl: () => null,
  resolveLangSmithRunUrl: async () => null,
  getLangSmithApiKey: () => null,
  getTraceProject: () => 'shipyard',
}));

vi.mock('../../src/runtime/persistence.js', () => ({
  createRun: async () => {},
  saveRunToFile: () => {},
  loadRunsFromFiles: () => [],
  loadRunFromFile: () => null,
  listRuns: async () => [],
  pgRowToRunSummary: () => null,
}));

import { InstructionLoop } from '../../src/runtime/loop.js';

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function releaseUntilIdle(loop: InstructionLoop, maxReleases = 10): Promise<void> {
  for (let i = 0; i < maxReleases; i += 1) {
    if (!loop.getStatus().processing) return;
    await waitFor(
      () => !loop.getStatus().processing || typeof releaseGraph === 'function',
      12000,
    );
    if (!loop.getStatus().processing) return;
    const release = releaseGraph;
    releaseGraph = null;
    release?.();
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('releaseUntilIdle exceeded maxReleases');
}

describe('InstructionLoop local chat shortcuts', () => {
  let loop: InstructionLoop;

  beforeEach(() => {
    releaseGraph = null;
    streamedStates = [];
    loop = new InstructionLoop();
  });

  afterEach(async () => {
    if (!loop) return;
    try {
      await releaseUntilIdle(loop, 20);
    } catch {
      // best-effort cleanup to prevent cross-test interference
    }
    releaseGraph = null;
  });

  it('completes trivial hi immediately even while another run is active', async () => {
    const blockingId = loop.submit('implement auth', undefined, false, 'code');
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === blockingId);

    const hiId = loop.submit('hi');
    await waitFor(() => !!loop.getRun(hiId));

    const hiRun = loop.getRun(hiId);
    expect(hiRun?.phase).toBe('done');
    expect(hiRun?.threadKind).toBe('ask');
    expect(hiRun?.messages.at(-1)?.content).toContain('Hi');
    expect(loop.getStatus().currentRunId).toBe(blockingId);

    releaseGraph?.();
    await waitFor(() => loop.getRun(blockingId)?.phase === 'done');
  });

  it('completes simple comparison questions immediately even while another run is active', async () => {
    const blockingId = loop.submit('implement auth', undefined, false, 'code');
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === blockingId);

    const mathId = loop.submit('2=2?');
    await waitFor(() => !!loop.getRun(mathId));

    const mathRun = loop.getRun(mathId);
    expect(mathRun?.phase).toBe('done');
    expect(mathRun?.threadKind).toBe('ask');
    expect(mathRun?.messages.at(-1)?.content).toContain('Answer: true');
    expect(loop.getStatus().currentRunId).toBe(blockingId);

    releaseGraph?.();
    await waitFor(() => loop.getRun(blockingId)?.phase === 'done');
  });

  it('completes trivial hi follow-up immediately even while another run is active', async () => {
    const askId = loop.submit('hi', undefined, false, 'chat');
    await waitFor(() => loop.getRun(askId)?.phase === 'done');

    const blockingId = loop.submit('implement auth', undefined, false, 'code');
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === blockingId);

    const ok = loop.followUpAsk(askId, 'hi');
    expect(ok).toBe(true);
    await waitFor(() => (loop.getRun(askId)?.messages.length ?? 0) >= 4);

    const askRun = loop.getRun(askId);
    expect(askRun?.phase).toBe('done');
    expect(askRun?.messages.at(-1)?.content).toContain('Hi');
    expect(loop.getStatus().currentRunId).toBe(blockingId);

    releaseGraph?.();
    await waitFor(() => loop.getRun(blockingId)?.phase === 'done');
  });

  it('queues ask follow-ups while the same ask thread is still processing', async () => {
    const askId = loop.submit('what is recursion?', undefined, false, 'chat');
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === askId);

    const ok = loop.followUpAsk(askId, 'and memoization?');
    expect(ok).toBe(true);
    expect(loop.getStatus().queueLength).toBe(1);

    await releaseUntilIdle(loop);
    await waitFor(() => loop.getRun(askId)?.phase === 'done', 12000);

    const askRun = loop.getRun(askId);
    expect(askRun?.threadKind).toBe('ask');
    expect(askRun?.messages.map((m) => m.content)).toEqual([
      'what is recursion?',
      'Done: what is recursion?',
      'and memoization?',
      'Done: and memoization?',
    ]);
  }, 30000);

  it('handles multiple follow-up asks on the same thread', async () => {
    const askId = loop.submit('hi', undefined, false, 'chat');
    await waitFor(() => loop.getRun(askId)?.phase === 'done');

    const ok1 = loop.followUpAsk(askId, 'what is recursion?');
    expect(ok1).toBe(true);
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === askId);

    const ok2 = loop.followUpAsk(askId, 'and memoization?');
    expect(ok2).toBe(true);
    expect(loop.getStatus().queueLength).toBe(1);

    await releaseUntilIdle(loop);
    await waitFor(() => loop.getRun(askId)?.phase === 'done', 12000);

    const askRun = loop.getRun(askId);
    expect(askRun?.threadKind).toBe('ask');
    expect(askRun?.messages.map((m) => m.content)).toEqual([
      'hi',
      'Hi. How can I help?',
      'what is recursion?',
      'Done: what is recursion?',
      'and memoization?',
      'Done: and memoization?',
    ]);
  }, 30000);

  it('applies code follow-ups live on the same active agent thread', async () => {
    const runId = loop.submit('implement auth', undefined, false, 'code');
    await waitFor(() => loop.getStatus().processing && loop.getStatus().currentRunId === runId);
    await waitFor(() => typeof releaseGraph === 'function');
    const releaseActive = releaseGraph;

    const ok = loop.followUpThread(runId, 'refactor small file');
    expect(ok).toBe(true);
    expect(loop.getStatus().queueLength).toBe(0);

    releaseActive?.();
    await waitFor(() => !loop.getStatus().processing && loop.getRun(runId)?.phase === 'done');

    const run = loop.getRun(runId);
    expect(run?.threadKind).toBe('agent');
    expect(run?.messages.map((m) => m.content)).toContain('implement auth');
    expect(run?.messages.at(-1)?.content).toContain('Done: implement auth');
    expect(streamedStates.length).toBe(1);
  });
});
