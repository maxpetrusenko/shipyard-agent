import { describe, it, expect, vi } from 'vitest';
import { InstructionLoop } from '../../src/runtime/loop.js';

vi.mock('../../src/graph/builder.js', () => ({
  createShipyardGraph: () => ({
    stream: async (state: Record<string, unknown>) => ({
      async *[Symbol.asyncIterator]() {
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
  buildTraceUrl: () => 'private-trace-url',
  resolveLangSmithRunUrl: async () => {
    await new Promise((r) => setTimeout(r, 1000));
    return 'public-trace-url';
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

describe('InstructionLoop trace finalization', () => {
  it('does not wait for public trace sharing before marking the run done', async () => {
    const loop = new InstructionLoop();
    const runId = loop.submit('implement auth', undefined, false, 'code');

    await new Promise((r) => setTimeout(r, 50));

    const run = loop.getRun(runId);
    expect(run?.phase).toBe('done');
    expect(run?.traceUrl).toBe('private-trace-url');
  });
});
