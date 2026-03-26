import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveLangSmithRunUrl: vi.fn(),
}));

vi.mock('../../src/runtime/langsmith.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runtime/langsmith.js')>();
  return {
    ...actual,
    resolveLangSmithRunUrl: mocks.resolveLangSmithRunUrl,
  };
});

import {
  buildRunDebugSnapshot,
  isSyntheticTraceUrl,
  resolveDebugTraceUrl,
} from '../../src/server/run-debug.js';

function makeRun() {
  return {
    runId: '8195ca03-adb9-4d41-bd18-cf749176c93f',
    phase: 'done',
    steps: [],
    fileEdits: [],
    toolCallHistory: [],
    tokenUsage: null,
    traceUrl: 'https://smith.langchain.com/o/default/projects/p/ship-agent/r/8195ca03-adb9-4d41-bd18-cf749176c93f',
    messages: [{ role: 'user', content: 'fix trace link' }],
    error: null,
    verificationResult: null,
    reviewFeedback: null,
    durationMs: 1,
    requestedUiMode: 'agent',
    threadKind: 'agent',
    runMode: 'code',
    executionPath: 'graph',
    queuedAt: null,
    startedAt: null,
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
    resolvedModels: null,
  };
}

describe('run debug trace helpers', () => {
  it('detects any internal LangSmith workspace trace URL', () => {
    expect(
      isSyntheticTraceUrl(
        'https://smith.langchain.com/o/default/projects/p/ship-agent/r/run-1',
      ),
    ).toBe(true);
    expect(
      isSyntheticTraceUrl(
        'https://smith.langchain.com/o/897647a5-0ac2-484c-a932-6f0fadab2950/projects/p/37f8686f-b665-4c2c-9fba-be0e39a74eb2/r/run-1',
      ),
    ).toBe(true);
    expect(
      isSyntheticTraceUrl(
        'https://smith.langchain.com/public/abc123/r',
      ),
    ).toBe(false);
  });

  it('refreshes internal org/project trace URLs for the debug modal', async () => {
    mocks.resolveLangSmithRunUrl.mockResolvedValue(
      'https://smith.langchain.com/public/shared-trace/r',
    );

    const run = {
      ...makeRun(),
      traceUrl:
        'https://smith.langchain.com/o/897647a5-0ac2-484c-a932-6f0fadab2950/projects/p/37f8686f-b665-4c2c-9fba-be0e39a74eb2/r/8195ca03-adb9-4d41-bd18-cf749176c93f?trace_id=8195ca03-adb9-4d41-bd18-cf749176c93f',
    };
    const traceUrl = await resolveDebugTraceUrl(run as any);
    const snapshot = buildRunDebugSnapshot(run as any, traceUrl);

    expect(mocks.resolveLangSmithRunUrl).toHaveBeenCalledWith(
      '8195ca03-adb9-4d41-bd18-cf749176c93f',
    );
    expect(snapshot.traceUrl).toBe('https://smith.langchain.com/public/shared-trace/r');
    expect(snapshot.openTraceUrl).toBe(snapshot.traceUrl);
  });

  it('resolves a trace for graph runs even when the stored traceUrl is missing', async () => {
    mocks.resolveLangSmithRunUrl.mockResolvedValue(
      'https://smith.langchain.com/public/resolved-from-run-id/r',
    );

    const run = {
      ...makeRun(),
      traceUrl: null,
      executionPath: 'graph',
    };
    const traceUrl = await resolveDebugTraceUrl(run as any);

    expect(mocks.resolveLangSmithRunUrl).toHaveBeenCalledWith(
      '8195ca03-adb9-4d41-bd18-cf749176c93f',
    );
    expect(traceUrl).toBe(
      'https://smith.langchain.com/public/resolved-from-run-id/r',
    );
  });

  it('includes requested ui mode separately from resolved thread kind', () => {
    const snapshot = buildRunDebugSnapshot({
      ...makeRun(),
      requestedUiMode: 'agent',
      threadKind: 'ask',
      runMode: 'auto',
      executionPath: 'local-shortcut',
    } as any);

    expect(snapshot.requestedUiMode).toBe('agent');
    expect(snapshot.threadKind).toBe('ask');
    expect(snapshot.runMode).toBe('auto');
    expect(snapshot.executionPath).toBe('local-shortcut');
  });
});
