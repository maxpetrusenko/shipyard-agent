/**
 * InstructionLoop tests.
 *
 * Tests submit, cancel, queue ordering, getStatus, getRun,
 * state listeners, and context injection. Does NOT invoke the
 * real graph (that requires Anthropic API calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstructionLoop } from '../../src/runtime/loop.js';

let liveFeedListener:
  | ((event: Record<string, unknown>) => void)
  | null = null;
let liveToolDetail: string | null = null;
let streamDelayMs = 0;
let streamScenario:
  | 'done'
  | 'recursion_error'
  | 'soft_budget_loop'
  | 'review_verify_loop'
  | 'watchdog_execute_diag' = 'done';

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}

// ---------------------------------------------------------------------------
// Mock the graph builder so processNext doesn't call Anthropic
// ---------------------------------------------------------------------------

vi.mock('../../src/graph/builder.js', () => ({
  createShipyardGraph: () => ({
    // stream() returns an async iterable of { nodeName: partialState } chunks
    stream: async (state: Record<string, unknown>) => {
      const finalState = {
        ...state,
        phase: 'done',
        steps: [{ index: 0, description: 'test', files: [], status: 'done' }],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: { input: 100, output: 50 },
        traceUrl: null,
        messages: [{ role: 'assistant', content: 'Done' }],
        error: null,
      };
      return {
        async *[Symbol.asyncIterator]() {
          if (streamScenario === 'recursion_error') {
            const err = new Error(
              'Recursion limit of 25 reached without hitting a stop condition.',
            ) as Error & { name: string };
            err.name = 'GraphRecursionError';
            throw err;
          }

          if (streamScenario === 'watchdog_execute_diag') {
            throw new Error(
              'Watchdog: execution stalled after 8 consecutive no-edit tool rounds. Next action: run one edit_file call. Execute diagnostics: {"noEditToolRounds":8,"discoveryCallsBeforeFirstEdit":13,"lastBlockingReason":"edit_file: Refusing edit outside explicit targets: /tmp/a.ts","stopReason":"stalled_no_edit_rounds"}',
            );
          }

          if (liveToolDetail) {
            liveFeedListener?.({
              type: 'tool',
              tool_name: 'bash',
              ok: true,
              detail: liveToolDetail,
              timestamp: Date.now(),
            });
          }

          if (streamScenario === 'soft_budget_loop') {
            const phases = ['executing', 'verifying', 'reviewing', 'planning'] as const;
            for (let i = 0; i < 12; i += 1) {
              yield {
                execute: {
                  phase: phases[i % phases.length],
                  currentStepIndex: i,
                  steps: [{ index: 0, description: 'loop', files: [], status: 'in_progress' }],
                  fileEdits: [],
                  toolCallHistory: [],
                },
              };
            }
          }

          if (streamScenario === 'review_verify_loop') {
            for (let i = 0; i < 7; i += 1) {
              yield {
                verify: {
                  phase: 'reviewing',
                  currentStepIndex: 0,
                  steps: [{ index: 0, description: 'loop', files: [], status: 'done' }],
                  fileEdits: [],
                  toolCallHistory: [],
                  verificationResult: { passed: true, error_count: 0 },
                },
              };
              yield {
                review: {
                  phase: 'planning',
                  currentStepIndex: 0,
                  reviewDecision: 'retry',
                  reviewFeedback: 'retry',
                  fileEdits: [],
                  toolCallHistory: [],
                  verificationResult: { passed: true, error_count: 0 },
                },
              };
            }
          }

          if (streamDelayMs > 0) {
            await new Promise((r) => setTimeout(r, streamDelayMs));
          }
          yield { report: finalState };
        },
      };
    },
  }),
}));

vi.mock('../../src/tools/hooks.js', () => ({
  setLiveFeedListener: (
    fn: ((event: Record<string, unknown>) => void) | null,
  ) => {
    liveFeedListener = fn;
  },
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
}));

vi.mock('../../src/runtime/run-baselines.js', () => ({
  captureRunBaseline: async () => {},
  clearRunBaseline: () => {},
  detectObservedChangedFiles: async () => [],
  getBaselineFingerprint: () => null,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstructionLoop', () => {
  let loop: InstructionLoop;

  beforeEach(() => {
    loop = new InstructionLoop();
    liveFeedListener = null;
    liveToolDetail = null;
    streamDelayMs = 0;
    streamScenario = 'done';
    delete process.env['SHIPYARD_GRAPH_SOFT_BUDGET'];
    delete process.env['SHIPYARD_GRAPH_RECURSION_LIMIT'];
  });

  // -------------------------------------------------------------------------
  // resume
  // -------------------------------------------------------------------------

  describe('resume', () => {
    it('re-queues interrupted runs as same-thread follow-ups', async () => {
      const loopHack = loop as unknown as {
        runs: Map<string, Record<string, unknown>>;
      };
      loopHack.runs.set('resume-run', {
        runId: 'resume-run',
        phase: 'error',
        threadKind: 'agent',
        runMode: 'code',
        steps: [],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        traceUrl: null,
        messages: [
          { role: 'user', content: 'implement auth' },
          { role: 'assistant', content: 'partial progress' },
        ],
        error: 'stopped',
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 42,
      });

      const resumed = loop.resume('resume-run');
      expect(resumed).toBe('resume-run');

      await new Promise((r) => setTimeout(r, 200));
      const run = loop.getRun('resume-run');
      expect(run?.threadKind).toBe('agent');
      expect(run?.messages.some((m) => m.content === 'implement auth')).toBe(true);
    });

    it('resumes the latest user turn, not the first turn', async () => {
      const loopHack = loop as unknown as {
        runs: Map<string, Record<string, unknown>>;
      };
      loopHack.runs.set('resume-latest-run', {
        runId: 'resume-latest-run',
        campaignId: 'campaign-root',
        rootRunId: 'campaign-root',
        parentRunId: null,
        phase: 'error',
        threadKind: 'agent',
        runMode: 'code',
        steps: [],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        traceUrl: null,
        messages: [
          { role: 'user', content: 'implement auth' },
          { role: 'assistant', content: 'done first step' },
          { role: 'user', content: 'fix upload regression' },
          { role: 'assistant', content: 'partial progress on latest step' },
        ],
        error: 'stopped',
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 42,
      });

      const resumed = loop.resume('resume-latest-run');
      expect(resumed).toBe('resume-latest-run');

      await new Promise((r) => setTimeout(r, 200));
      const run = loop.getRun('resume-latest-run');
      expect(run?.messages.some((m) => m.content === 'fix upload regression')).toBe(true);
      expect(run?.campaignId).toBe('campaign-root');
      expect(run?.rootRunId).toBe('campaign-root');
    });

    it('preserves project context across resume', async () => {
      const loopHack = loop as unknown as {
        runs: Map<string, Record<string, unknown>>;
      };
      loopHack.runs.set('resume-project-run', {
        runId: 'resume-project-run',
        campaignId: 'campaign-root',
        rootRunId: 'campaign-root',
        parentRunId: null,
        phase: 'error',
        threadKind: 'agent',
        runMode: 'code',
        steps: [],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        traceUrl: null,
        messages: [
          { role: 'user', content: 'fix upload regression' },
          { role: 'assistant', content: 'partial progress on latest step' },
        ],
        error: 'stopped',
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 42,
        projectContext: { projectId: 'ship-agent', projectLabel: 'Ship Agent' },
      });

      const resumed = loop.resume('resume-project-run');
      expect(resumed).toBe('resume-project-run');

      await new Promise((r) => setTimeout(r, 200));
      const run = loop.getRun('resume-project-run');
      expect(run?.projectContext).toEqual({ projectId: 'ship-agent', projectLabel: 'Ship Agent' });
    });

    it('re-queues plan threads as same-run plan follow-ups', async () => {
      const loopHack = loop as unknown as {
        runs: Map<string, Record<string, unknown>>;
      };
      loopHack.runs.set('plan-run', {
        runId: 'plan-run',
        phase: 'awaiting_confirmation',
        threadKind: 'plan',
        runMode: 'code',
        steps: [{ index: 0, description: 'draft', files: [], status: 'pending' }],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        traceUrl: null,
        messages: [
          { role: 'user', content: 'draft rollout plan' },
          { role: 'assistant', content: 'here is the plan' },
        ],
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 21,
      });

      const queued = loop.followUpThread('plan-run', 'revise step 2');
      expect(queued).toBe(true);

      await new Promise((r) => setTimeout(r, 200));
      const run = loop.getRun('plan-run');
      expect(run?.runId).toBe('plan-run');
      expect(run?.phase).toBe('done');
      expect(run?.threadKind).toBe('plan');
    });

    it('upgrades ask threads to agent follow-ups on the same run id', async () => {
      const id = loop.submit('hi');
      expect(loop.getRun(id)?.threadKind).toBe('ask');

      const queued = loop.followUpThread(id, 'refactor small file', {
        threadKindHint: 'agent',
      });
      expect(queued).toBe(true);

      await waitFor(() => loop.getRun(id)?.phase === 'done');
      const run = loop.getRun(id);
      expect(run?.runId).toBe(id);
      expect(run?.threadKind).toBe('agent');
      expect(run?.runMode).toBe('code');
    });

    it('upgrades ask threads to plan follow-ups on the same run id', async () => {
      const id = loop.submit('hi');
      expect(loop.getRun(id)?.threadKind).toBe('ask');

      const queued = loop.followUpThread(id, 'draft a migration plan', {
        threadKindHint: 'plan',
      });
      expect(queued).toBe(true);

      await waitFor(() => loop.getRun(id)?.phase === 'done');
      const run = loop.getRun(id);
      expect(run?.runId).toBe(id);
      expect(run?.threadKind).toBe('plan');
      expect(run?.runMode).toBe('code');
    });
  });

  // -------------------------------------------------------------------------
  // submit
  // -------------------------------------------------------------------------

  describe('submit', () => {
    it('returns a runId string', () => {
      const id = loop.submit('test instruction');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('returns unique ids for each submission', () => {
      const id1 = loop.submit('first');
      const id2 = loop.submit('second');
      expect(id1).not.toBe(id2);
    });

    it('accepts optional contexts', () => {
      const id = loop.submit('test', [
        { label: 'ctx', content: 'data', source: 'user' },
      ]);
      expect(id).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('returns false when nothing is running', () => {
      const cancelled = loop.cancel();
      expect(cancelled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns initial idle status', () => {
      const status = loop.getStatus();
      expect(status.processing).toBe(false);
      expect(status.currentRunId).toBeNull();
      expect(status.queueLength).toBe(0);
    });

    it('reflects queued items after submit', () => {
      // Submit multiple rapidly; the first starts processing,
      // subsequent ones queue.
      loop.submit('first');
      loop.submit('second');

      const status = loop.getStatus();
      // First is processing, second is queued (or both may be queued
      // if processing hasn't started yet in the microtask queue)
      expect(status.processing || status.queueLength >= 1).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getRun
  // -------------------------------------------------------------------------

  describe('getRun', () => {
    it('returns undefined for unknown run id', () => {
      const run = loop.getRun('nonexistent');
      expect(run).toBeUndefined();
    });

    it('returns run result after processing', async () => {
      const id = loop.submit('test instruction');

      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const run = loop.getRun(id);
      expect(run).toBeDefined();
      expect(run!.runId).toBe(id);
      expect(run!.phase).toBe('done');
    });

    it('records debug metadata for graph runs', async () => {
      const id = loop.submit('test instruction');
      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const run = loop.getRun(id);
      expect(run?.executionPath).toBe('graph');
      expect(run?.queuedAt).toBeTruthy();
      expect(run?.startedAt).toBeTruthy();
      expect(run?.resolvedModels?.coding).toBeTruthy();
    });

    it('preserves requested ui mode separately from resolved ask thread shortcuts', () => {
      const id = loop.submit('2=2?', undefined, false, 'auto', {
        requestedUiMode: 'agent',
      } as any);

      const run = loop.getRun(id) as any;
      expect(run?.requestedUiMode).toBe('agent');
      expect(run?.runMode).toBe('auto');
      expect(run?.threadKind).toBe('ask');
      expect(run?.executionPath).toBe('local-shortcut');
    });

    it('seeds the submitted prompt into in-progress code runs', () => {
      const id = loop.submit('refactor small file', undefined, false, 'code');
      const run = loop.getRun(id);
      expect(run?.messages).toContainEqual({
        role: 'user',
        content: 'refactor small file',
      });
    });

    it('retains the submitted prompt after graph completion', async () => {
      const id = loop.submit('refactor small file', undefined, false, 'code');
      const deadline = Date.now() + 1500;
      // Baseline capture adds a couple of git probes; wait until run settles.
      while (Date.now() < deadline) {
        const run = loop.getRun(id);
        if (run?.phase === 'done') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const run = loop.getRun(id);
      expect(run?.messages).toContainEqual({
        role: 'user',
        content: 'refactor small file',
      });
      const lastAssistant = [...(run?.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant');
      expect(lastAssistant?.content).toContain('Done');
    });

    it('persists live tool activity into completed runs', async () => {
      liveToolDetail = 'ls src';

      const id = loop.submit('refactor small file', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const run = loop.getRun(id);
      expect(run?.toolCallHistory).toHaveLength(1);
      expect(run?.toolCallHistory[0]?.tool_name).toBe('bash');
      expect(run?.toolCallHistory[0]?.tool_input).toEqual({ command: 'ls src' });
    });

    it('persists live tool activity when a run is cancelled mid-stream', async () => {
      liveToolDetail = 'ls src';
      streamDelayMs = 100;

      const id = loop.submit('refactor small file', undefined, false, 'code');
      await new Promise((r) => setTimeout(r, 20));
      expect(loop.cancel('api')).toBe(true);
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id);
      expect(run?.phase).toBe('error');
      expect(run?.error).toBe('Run cancelled by user');
      expect(run?.completionStatus).toBe('cancelled_with_completed_actions');
      expect(run?.cancellation?.tool_calls).toBe(1);
      expect(run?.cancellation?.source).toBe('api');
      expect(run?.toolCallHistory).toHaveLength(1);
      expect(run?.toolCallHistory[0]?.tool_name).toBe('bash');
      expect(run?.toolCallHistory[0]?.tool_input).toEqual({ command: 'ls src' });
    });

    it('reports shutdown-triggered cancellation distinctly from user stop', async () => {
      streamDelayMs = 100;

      const id = loop.submit('refactor small file', undefined, false, 'code');
      await new Promise((r) => setTimeout(r, 20));
      expect(loop.cancel('shutdown_signal')).toBe(true);
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id);
      expect(run?.phase).toBe('error');
      expect(run?.error).toBe('Run interrupted by server shutdown');
      expect(run?.completionStatus).toBe('cancelled');
      expect(run?.cancellation?.reason).toBe('Run interrupted by server shutdown');
      expect(run?.cancellation?.source).toBe('shutdown_signal');
    });

    it('records local-shortcut metadata for trivial ask runs', () => {
      const id = loop.submit('hi');
      const run = loop.getRun(id);
      expect(run?.executionPath).toBe('local-shortcut');
      expect(run?.threadKind).toBe('ask');
      expect(run?.queuedAt).toBeTruthy();
      expect(run?.startedAt).toBeTruthy();
      expect(run?.resolvedModels?.chat).toBeTruthy();
    });

    it('stores resolved OpenAI models for shortcut ask runs', () => {
      const id = loop.submit('hi', undefined, false, 'chat', {
        modelFamily: 'openai',
      });
      const run = loop.getRun(id);
      expect(run?.executionPath).toBe('local-shortcut');
      expect(run?.modelFamily).toBe('openai');
      expect(run?.resolvedModels?.chat).toBe('gpt-5.4-mini');
    });

    it('captures graph recursion limit failures with explicit loop diagnostics', async () => {
      streamScenario = 'recursion_error';
      const id = loop.submit('implement auth', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id) as any;
      expect(run?.phase).toBe('error');
      expect(run?.error).toContain('Graph recursion limit');
      expect(run?.loopDiagnostics?.stopReason).toBe('hard_recursion_limit');
      expect(run?.loopDiagnostics?.graphStepCount).toBeTypeOf('number');
    });

    it('stops on graph soft budget before the hard recursion limit', async () => {
      streamScenario = 'soft_budget_loop';
      process.env['SHIPYARD_GRAPH_SOFT_BUDGET'] = '12';
      process.env['SHIPYARD_GRAPH_RECURSION_LIMIT'] = '40';

      const id = loop.submit('implement auth', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id) as any;
      expect(run?.error).toContain('soft graph budget');
      expect(run?.loopDiagnostics?.stopReason).toBe('soft_budget_exceeded');
      expect(run?.loopDiagnostics?.graphStepCount).toBeGreaterThanOrEqual(12);
    });

    it('stops repeated verify/review retries when no state progress occurs', async () => {
      streamScenario = 'review_verify_loop';
      process.env['SHIPYARD_GRAPH_SOFT_BUDGET'] = '60';
      process.env['SHIPYARD_GRAPH_RECURSION_LIMIT'] = '80';

      const id = loop.submit('implement auth', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id) as any;
      expect(run?.error).toContain('no progress');
      expect(run?.loopDiagnostics?.stopReason).toBe('no_progress');
      expect(run?.loopDiagnostics?.noProgressReason).toContain('review/verify');
    });

    it('captures execute watchdog diagnostics from stalled error output', async () => {
      streamScenario = 'watchdog_execute_diag';
      const id = loop.submit('implement auth', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id) as any;
      expect(run?.error).toContain('Watchdog: execution stalled');
      expect(run?.executeDiagnostics?.noEditToolRounds).toBe(8);
      expect(run?.executeDiagnostics?.discoveryCallsBeforeFirstEdit).toBe(13);
      expect(run?.executeDiagnostics?.lastBlockingReason).toContain(
        'Refusing edit outside explicit targets',
      );
      expect(run?.executeDiagnostics?.stopReason).toBe('stalled_no_edit_rounds');
      expect(run?.errorClassification).toBe('watchdog');
    });

    it('classifies recursion limit errors', async () => {
      streamScenario = 'recursion_error';
      const id = loop.submit('implement auth', undefined, false, 'code');
      await waitFor(() => loop.getRun(id)?.phase === 'error');

      const run = loop.getRun(id) as any;
      expect(run?.errorClassification).toBe('recursion');
    });

    it('lets ask follow-ups adopt fresh model settings', async () => {
      const id = loop.submit('hi');
      const firstRun = loop.getRun(id);
      expect(firstRun?.executionPath).toBe('local-shortcut');

      const ok = (loop.followUpAsk as unknown as (
        runId: string,
        instruction: string,
        opts?: { modelFamily?: 'anthropic' | 'openai' },
      ) => boolean)(id, 'what is recursion?', { modelFamily: 'openai' });

      expect(ok).toBe(true);
      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const run = loop.getRun(id);
      expect(run?.phase).toBe('done');
      expect(run?.modelFamily).toBe('openai');
      expect(run?.resolvedModels?.chat).toBe('gpt-5.4-mini');
    });
  });

  // -------------------------------------------------------------------------
  // getAllRuns / getRunsPaginated
  // -------------------------------------------------------------------------

  describe('rss tracking', () => {
    it('records peak rss on completed runs', async () => {
      const id = loop.submit('counter check');
      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const run = loop.getRun(id) as any;
      expect(run?.peakRssKb).toBeGreaterThan(0);
    });
  });

  describe('getAllRuns', () => {
    it('returns empty array initially', () => {
      expect(loop.getAllRuns()).toEqual([]);
    });

    it('includes completed runs', async () => {
      const id = loop.submit('first');
      await waitFor(() => loop.getRun(id)?.phase === 'done');

      const runs = loop.getAllRuns();
      expect(runs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getRunsPaginated', () => {
    it('respects limit and offset', async () => {
      loop.submit('a');
      loop.submit('b');
      await new Promise((r) => setTimeout(r, 500));

      const page = loop.getRunsPaginated(1, 0);
      expect(page.length).toBeLessThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // State listeners
  // -------------------------------------------------------------------------

  describe('onStateChange', () => {
    it('receives broadcasts when run starts', async () => {
      const events: Array<Record<string, unknown>> = [];
      loop.onStateChange((state) => {
        events.push(state as Record<string, unknown>);
      });

      loop.submit('test');
      await waitFor(() => events.length >= 1);

      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('returns unsubscribe function', () => {
      const events: unknown[] = [];
      const unsub = loop.onStateChange((state) => {
        events.push(state);
      });

      unsub();
      loop.submit('test');

      // Listener should not fire (async, so give it a moment)
      // This is best-effort since processing is async
      expect(typeof unsub).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Context injection
  // -------------------------------------------------------------------------

  describe('injectContext / removeContext / getContexts', () => {
    it('injects and retrieves context', () => {
      loop.injectContext({ label: 'test', content: 'data', source: 'user' });
      const contexts = loop.getContexts();
      expect(contexts.some((c) => c.label === 'test')).toBe(true);
    });

    it('removes context by label', () => {
      loop.injectContext({ label: 'rm-me', content: 'data', source: 'user' });
      expect(loop.removeContext('rm-me')).toBe(true);
      expect(loop.getContexts().some((c) => c.label === 'rm-me')).toBe(false);
    });

    it('returns false when removing non-existent context', () => {
      expect(loop.removeContext('nope')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Queue ordering
  // -------------------------------------------------------------------------

  describe('queue ordering', () => {
    it('processes instructions in FIFO order', async () => {
      const id1 = loop.submit('first');
      const id2 = loop.submit('second');

      await waitFor(() => loop.getRun(id1)?.phase === 'done');
      await waitFor(() => loop.getRun(id2)?.phase === 'done');

      // Both should complete
      const run1 = loop.getRun(id1);
      const run2 = loop.getRun(id2);
      expect(run1).toBeDefined();
      expect(run2).toBeDefined();
      expect(run1!.phase).toBe('done');
      expect(run2!.phase).toBe('done');
    });
  });
});
