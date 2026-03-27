import { afterEach, describe, it, expect, vi } from 'vitest';
import { InstructionLoop } from '../../src/runtime/loop.js';

let shouldThrow = false;

vi.mock('../../src/graph/builder.js', () => ({
  createShipyardGraph: () => ({
    stream: async (state: Record<string, unknown>) => ({
      async *[Symbol.asyncIterator]() {
        if (shouldThrow) {
          throw new Error('model rejected request');
        }
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
              { role: 'user', content: String(state.instruction ?? '') },
              { role: 'assistant', content: 'done' },
            ],
            error: null,
          },
        };
      },
    }),
  }),
}));

vi.mock('../../src/runtime/langsmith.js', () => ({
  isTracingEnabled: () => true,
  canTrace: () => true,
  isPublicTraceEnabled: () => true,
  buildTraceUrl: () =>
    'https://smith.langchain.com/o/default/projects/p/shipyard/r/fallback-run',
  resolveLangSmithRunUrl: async () => {
    await new Promise((r) => setTimeout(r, 100));
    return 'https://smith.langchain.com/public/shared-run/r';
  },
  getLangSmithApiKey: () => 'key',
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

async function waitFor(predicate: () => boolean, timeoutMs = 750): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('InstructionLoop trace finalization', () => {
  afterEach(() => {
    shouldThrow = false;
  });

  it('does not wait for public trace sharing before marking the run done', async () => {
    const loop = new InstructionLoop();
    const runId = loop.submit('implement auth', undefined, false, 'code');
    await waitFor(() => loop.getRun(runId)?.phase === 'done');

    const run = loop.getRun(runId);
    expect(run?.phase).toBe('done');
    expect(run?.traceUrl).toBe(
      'https://smith.langchain.com/o/default/projects/p/shipyard/r/fallback-run',
    );
  });

  it('upgrades failed runs to a public trace URL in the background', async () => {
    shouldThrow = true;

    const loop = new InstructionLoop();
    const runId = loop.submit('refactor small file', undefined, false, 'code');
    await waitFor(() => loop.getRun(runId)?.phase === 'error');

    const initialRun = loop.getRun(runId);
    expect(initialRun?.phase).toBe('error');
    expect(initialRun?.traceUrl).toBe(
      'https://smith.langchain.com/o/default/projects/p/shipyard/r/fallback-run',
    );

    await new Promise((r) => setTimeout(r, 150));

    const updatedRun = loop.getRun(runId);
    expect(updatedRun?.phase).toBe('error');
    expect(updatedRun?.traceUrl).toBe(
      'https://smith.langchain.com/public/shared-run/r',
    );
  });
});
