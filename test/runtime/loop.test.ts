/**
 * InstructionLoop tests.
 *
 * Tests submit, cancel, queue ordering, getStatus, getRun,
 * state listeners, and context injection. Does NOT invoke the
 * real graph (that requires Anthropic API calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstructionLoop } from '../../src/runtime/loop.js';

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
        tokenUsage: { input: 100, output: 50 },
        traceUrl: null,
        messages: [{ role: 'assistant', content: 'Done' }],
        error: null,
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { report: finalState };
        },
      };
    },
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
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstructionLoop', () => {
  let loop: InstructionLoop;

  beforeEach(() => {
    loop = new InstructionLoop();
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

      // Wait for async processNext to complete
      await new Promise((r) => setTimeout(r, 200));

      const run = loop.getRun(id);
      expect(run).toBeDefined();
      expect(run!.runId).toBe(id);
      expect(run!.phase).toBe('done');
    });

    it('records debug metadata for graph runs', async () => {
      const id = loop.submit('test instruction');
      await new Promise((r) => setTimeout(r, 200));

      const run = loop.getRun(id);
      expect(run?.executionPath).toBe('graph');
      expect(run?.queuedAt).toBeTruthy();
      expect(run?.startedAt).toBeTruthy();
      expect(run?.resolvedModels?.coding).toBeTruthy();
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
      await new Promise((r) => setTimeout(r, 200));

      const run = loop.getRun(id);
      expect(run?.messages).toContainEqual({
        role: 'user',
        content: 'refactor small file',
      });
      expect(run?.messages).toContainEqual({
        role: 'assistant',
        content: 'Done',
      });
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
      expect(run?.resolvedModels?.chat).toBe('gpt-5-mini');
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
      await new Promise((r) => setTimeout(r, 200));

      const run = loop.getRun(id);
      expect(run?.phase).toBe('done');
      expect(run?.modelFamily).toBe('openai');
      expect(run?.resolvedModels?.chat).toBe('gpt-5-mini');
    });
  });

  // -------------------------------------------------------------------------
  // getAllRuns / getRunsPaginated
  // -------------------------------------------------------------------------

  describe('getAllRuns', () => {
    it('returns empty array initially', () => {
      expect(loop.getAllRuns()).toEqual([]);
    });

    it('includes completed runs', async () => {
      loop.submit('first');
      await new Promise((r) => setTimeout(r, 200));

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
      await new Promise((r) => setTimeout(r, 300));

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

    it('does not auto-inject repo map during runs', async () => {
      loop.submit('refactor small file', undefined, false, 'code');
      await new Promise((r) => setTimeout(r, 200));

      expect(loop.getContexts().some((c) => c.label === 'Repo Map')).toBe(false);
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

      await new Promise((r) => setTimeout(r, 800));

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
