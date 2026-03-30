import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let activeGraphRuns = 0;
let maxActiveGraphRuns = 0;
let graphDelayMs = 75;

vi.mock('../../src/graph/builder.js', () => ({
  createShipyardGraph: vi.fn(() => ({
    stream: vi.fn(async (state: any) => ({
      async *[Symbol.asyncIterator]() {
        activeGraphRuns += 1;
        maxActiveGraphRuns = Math.max(maxActiveGraphRuns, activeGraphRuns);
        await new Promise((resolve) => setTimeout(resolve, graphDelayMs));
        activeGraphRuns -= 1;
        yield {
          report: {
            ...state,
            phase: 'done',
            steps: state.steps ?? [],
            fileEdits: [],
            toolCallHistory: [],
            tokenUsage: null,
            traceUrl: null,
            messages: [...(state.messages ?? []), { role: 'assistant', content: 'Done' }],
            error: null,
            verificationResult: { passed: true, error_count: 0 },
            reviewFeedback: null,
          },
        };
      },
    })),
  })),
}));

vi.mock('../../src/tools/hooks.js', () => ({
  setLiveFeedListener: () => () => {},
}));

vi.mock('../../src/runtime/langsmith.js', () => ({
  canTrace: () => false,
  buildTraceUrl: () => null,
  resolveLangSmithRunUrl: async () => null,
}));

vi.mock('../../src/runtime/persistence.js', async () => {
  const actual = await vi.importActual('../../src/runtime/persistence.js');
  return {
    ...actual,
    saveRunToFile: () => null,
    loadRunsFromFiles: () => [],
    loadRunFromFile: () => null,
    listRuns: async () => [],
  };
});

vi.mock('../../src/runtime/run-baselines.js', () => ({
  captureRunBaseline: async () => {},
  clearRunBaseline: () => {},
  detectObservedChangedFiles: async () => [],
  getBaselineFingerprint: async () => null,
}));

import { ProjectInstructionLoop } from '../../src/runtime/project-loop.js';

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ProjectInstructionLoop', () => {
  let rootDir: string;
  let projectsFile: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'shipyard-project-loop-'));
    mkdirSync(join(rootDir, 'ship-agent'), { recursive: true });
    projectsFile = join(rootDir, 'projects.json');
    activeGraphRuns = 0;
    maxActiveGraphRuns = 0;
    graphDelayMs = 75;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes local ask runs to the selected project workdir', () => {
    const loop = new ProjectInstructionLoop({
      workDir: join(rootDir, 'ship-agent'),
      projectsFile,
    });
    const project = loop.createProject({ label: 'Ship 2' });

    const runId = loop.submit('hi', undefined, false, 'chat', {
      projectContext: { projectId: project.id, projectLabel: project.label },
    });

    const run = loop.getRun(runId);
    expect(run?.phase).toBe('done');
    expect(run?.workDir).toBe(project.workDir);
    expect(run?.projectContext).toEqual({
      projectId: project.id,
      projectLabel: project.label,
    });
  });

  it('runs code jobs concurrently across different projects', async () => {
    const loop = new ProjectInstructionLoop({
      workDir: join(rootDir, 'ship-agent'),
      projectsFile,
    });
    const alpha = loop.createProject({ label: 'Alpha' });
    const beta = loop.createProject({ label: 'Beta' });

    const alphaRun = loop.submit('implement auth', undefined, false, 'code', {
      projectContext: { projectId: alpha.id, projectLabel: alpha.label },
    });
    const betaRun = loop.submit('implement auth', undefined, false, 'code', {
      projectContext: { projectId: beta.id, projectLabel: beta.label },
    });

    await waitFor(() => loop.getRun(alphaRun)?.phase === 'done' && loop.getRun(betaRun)?.phase === 'done', 5000);

    expect(loop.getRun(alphaRun)?.workDir).toBe(alpha.workDir);
    expect(loop.getRun(betaRun)?.workDir).toBe(beta.workDir);
    expect(maxActiveGraphRuns).toBeGreaterThanOrEqual(2);
  });

  it('reports per-project queue status details', async () => {
    const loop = new ProjectInstructionLoop({
      workDir: join(rootDir, 'ship-agent'),
      projectsFile,
    });
    const alpha = loop.createProject({ label: 'Alpha' });
    const beta = loop.createProject({ label: 'Beta' });

    const alphaRun = loop.submit('implement auth', undefined, false, 'code', {
      projectContext: { projectId: alpha.id, projectLabel: alpha.label },
    });
    const betaRun = loop.submit('implement auth', undefined, false, 'code', {
      projectContext: { projectId: beta.id, projectLabel: beta.label },
    });

    await waitFor(() => {
      const status = loop.getStatus() as any;
      return status.processing && Array.isArray(status.activeRunIds) && status.activeRunIds.length >= 2;
    }, 2_000);

    const status = loop.getStatus() as any;
    expect(status.activeRunIds).toEqual(expect.arrayContaining([alphaRun, betaRun]));
    expect(status.projectStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: alpha.id,
        projectLabel: alpha.label,
        currentRunId: alphaRun,
        processing: true,
      }),
      expect.objectContaining({
        projectId: beta.id,
        projectLabel: beta.label,
        currentRunId: betaRun,
        processing: true,
      }),
    ]));

    await waitFor(() => !loop.getStatus().processing, 5_000);
    expect((loop.getStatus() as any).activeRunIds).toEqual([]);
  });
});
